import { decimal } from '../../../common/utils/http.utils';

export function subtotalIdr(items: Array<Record<string, any>>): number {
  return items.reduce((sum, item) => sum + Number(item.unitPriceForeign || 0) * Number(item.quantity || 1), 0);
}

export function calculateOrderTotals(input: Record<string, any>, items: Array<Record<string, any>>) {
  const productSubtotalIdr = items.reduce(
    (sum, item) => sum + decimal(item.unitPriceForeign) * decimal(item.quantity, 1),
    0
  );
  const serviceFee = decimal(input.serviceFee);
  const localShipping = decimal(input.localShipping);
  const customerShipping = decimal(input.customerShipping);
  const additionalFee = decimal(input.additionalFee);
  const discount = decimal(input.discount);
  const totalBill = productSubtotalIdr + serviceFee + localShipping + customerShipping + additionalFee - discount;
  const paidAmount = decimal(input.paidAmount);

  return {
    productSubtotalForeign: productSubtotalIdr,
    productSubtotalIdr,
    serviceFee,
    localShipping,
    internationalShipping: 0,
    customerShipping,
    additionalFee,
    discount,
    totalBill,
    paidAmount,
    outstandingAmount: Math.max(0, totalBill - paidAmount),
  };
}
