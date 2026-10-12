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
  const estimated = Number(
    current.shipping_cost || current.order?.customer_shipping || 0
  );
  const diff = actual - estimated;
  cleaned.shipping_cost_difference = diff;

  if (diff > 0) {
    // Case A: Ongkir Kurang (Customer owes difference)
    cleaned.status = 'WAITING_SETTLEMENT';
    const newTotalBill = Number(current.order.total_bill) + diff;
    const newOutstanding = Math.max(0, Number(current.order.outstanding_amount) + diff);

    await prisma.order.update({
      where: { id: current.order_id },
      data: {
        customer_shipping: actual,
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
    return 'WAITING_SETTLEMENT';
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
