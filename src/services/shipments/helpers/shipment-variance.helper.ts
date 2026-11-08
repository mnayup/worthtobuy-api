import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { RefundService } from '../../shared/refund.service';
import { InvoiceCalcService } from '../../shared/invoice-calc.service';

export interface HandleShippingCostVarianceParams {
  prisma: PrismaService;
  refundService: RefundService;
  invoiceCalcService: InvoiceCalcService;
  current: any;
  cleaned: any;
  targetStatus: string;
}

export async function processShippingCostVariance({
  prisma,
  refundService,
  invoiceCalcService,
  current,
  cleaned,
  targetStatus,
}: HandleShippingCostVarianceParams): Promise<string> {
  const hasActual =
    cleaned.actual_shipping_cost !== undefined &&
    cleaned.actual_shipping_cost !== null;

  if (!hasActual) {
    return targetStatus;
  }

  const actual = Number(cleaned.actual_shipping_cost);
  const prevPositiveDiff = Math.max(0, Number(current.shipping_cost_difference || 0));
  const baseTotalBill = Math.max(0, Number(current.order?.total_bill || 0) - prevPositiveDiff);
  const baseCustomerShipping = Math.max(
    0,
    Number(current.order?.customer_shipping || 0) - prevPositiveDiff
  );
  const estimated = Number(
    current.shipping_cost !== undefined && current.shipping_cost !== null
      ? current.shipping_cost
      : baseCustomerShipping
  );
  const diff = actual - estimated;
  cleaned.shipping_cost_difference = diff;

  if (diff > 0) {
    // Case A: Ongkir Kurang (Customer owes difference)
    const newTotalBill = baseTotalBill + diff;
    const newCustomerShipping = baseCustomerShipping + diff;
    const paidAmount = Number(current.order?.paid_amount || 0);
    const newOutstanding = Math.max(0, newTotalBill - paidAmount);

    await prisma.order.update({
      where: { id: current.order_id },
      data: {
        customer_shipping: newCustomerShipping,
        total_bill: newTotalBill,
        outstanding_amount: newOutstanding,
        status: 'WAITING_SETTLEMENT',
      },
    });

    await prisma.invoice_order.updateMany({
      where: { order_id: current.order_id },
      data: { snapshot_amount: newTotalBill },
    });

    await invoiceCalcService.refreshPaymentTarget({ order_id: current.order_id });

    const refreshedOrder = await prisma.order.findUnique({
      where: { id: current.order_id },
      select: { outstanding_amount: true },
    });
    if (refreshedOrder && Number(refreshedOrder.outstanding_amount || 0) <= 0) {
      cleaned.status = 'IN_TRANSIT';
      return 'IN_TRANSIT';
    }

    cleaned.status = 'WAITING_SETTLEMENT';
    return 'WAITING_SETTLEMENT';
  }

  if (prevPositiveDiff > 0 && current.order_id) {
    const paidAmount = Number(current.order?.paid_amount || 0);
    const restoredOutstanding = Math.max(0, baseTotalBill - paidAmount);
    await prisma.order.update({
      where: { id: current.order_id },
      data: {
        customer_shipping: baseCustomerShipping,
        total_bill: baseTotalBill,
        outstanding_amount: restoredOutstanding,
      },
    });
    await prisma.invoice_order.updateMany({
      where: { order_id: current.order_id },
      data: { snapshot_amount: baseTotalBill },
    });
    await invoiceCalcService.refreshPaymentTarget({ order_id: current.order_id });
  }

  if (diff < 0) {
    // Case B: Ongkir Lebih (Overpayment becomes refund)
    const overpayment = Math.abs(diff);
    await refundService.ensureShippingRefund(current.id, current.order_id, overpayment);
    cleaned.status = 'IN_TRANSIT';
    return 'IN_TRANSIT';
  }

  // Case C: diff === 0
  cleaned.status = 'IN_TRANSIT';
  return 'IN_TRANSIT';
}
