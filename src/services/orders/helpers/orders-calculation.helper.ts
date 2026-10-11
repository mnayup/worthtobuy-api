import { decimal } from '../../../common/utils/http.utils';

export function subtotalIdr(items: Array<Record<string, any>>): number {
  return items.reduce((sum, item) => {
    const price = Number(item.unit_price_foreign ?? item.unitPriceForeign ?? item.target_price_idr ?? item.targetPriceIdr ?? 0);
    const qty = Number(item.quantity || 1);
    return sum + price * qty;
  }, 0);
}

export function calculateOrderTotals(
  input: Record<string, any>,
  items: Array<Record<string, any>>
) {
  const productSubtotalIdr = items.reduce((sum, item) => {
    const price = decimal(
      item.unit_price_foreign ??
        item.unitPriceForeign ??
        item.target_price_idr ??
        item.targetPriceIdr
    );
    const qty = decimal(item.quantity, 1);
    return sum + price * qty;
  }, 0);

  const serviceFee = decimal(input.service_fee ?? input.serviceFee);
  const localShipping = decimal(input.local_shipping ?? input.localShipping);
  const customerShipping = decimal(
    input.customer_shipping !== undefined
      ? input.customer_shipping
      : input.customerShipping
  );
  const additionalFee = decimal(input.additional_fee ?? input.additionalFee);
  const discount = decimal(input.discount);
  const totalBill =
    productSubtotalIdr + serviceFee + localShipping + customerShipping + additionalFee - discount;
  const paidAmount = decimal(input.paid_amount ?? input.paidAmount);

  return {
    product_subtotal_foreign: productSubtotalIdr,
    product_subtotal_idr: productSubtotalIdr,
    service_fee: serviceFee,
    local_shipping: localShipping,
    international_shipping: 0,
    customer_shipping: customerShipping,
    additional_fee: additionalFee,
    discount,
    total_bill: totalBill,
    paid_amount: paidAmount,
    outstanding_amount: Math.max(0, totalBill - paidAmount),
  };
}

