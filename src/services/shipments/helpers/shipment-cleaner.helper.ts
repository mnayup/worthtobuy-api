export function cleanShipmentData(body: any): any {
  if (!body || typeof body !== 'object') return {};
  const cleaned: any = {};

  if (body.tracking_number !== undefined || body.trackingNumber !== undefined) {
    const val = body.tracking_number !== undefined ? body.tracking_number : body.trackingNumber;
    cleaned.tracking_number = val ? String(val).trim() : null;
  }
  if (body.order_id !== undefined || body.orderId !== undefined) {
    const val = body.order_id !== undefined ? body.order_id : body.orderId;
    if (val !== null && val !== undefined) cleaned.order_id = Number(val);
  }
  if (body.customer_id !== undefined || body.customerId !== undefined) {
    const val = body.customer_id !== undefined ? body.customer_id : body.customerId;
    if (val !== null && val !== undefined) cleaned.customer_id = Number(val);
  }
  if (body.shipping_counter_id !== undefined || body.shippingCounterId !== undefined) {
    const val = body.shipping_counter_id !== undefined ? body.shipping_counter_id : body.shippingCounterId;
    cleaned.shipping_counter_id = val !== null && val !== undefined && val !== '' ? Number(val) : null;
  }
  if (body.address !== undefined) {
    cleaned.address = String(body.address || '').trim();
  }
  if (body.courier !== undefined) {
    cleaned.courier = String(body.courier || '').trim();
  }
  if (body.service_type !== undefined || body.serviceType !== undefined) {
    const val = body.service_type !== undefined ? body.service_type : body.serviceType;
    cleaned.service_type = val ? String(val).trim() : null;
  }
  if (
    body.weight_kg !== undefined ||
    body.weightKg !== undefined ||
    body.actual_weight_kg !== undefined ||
    body.actualWeightKg !== undefined
  ) {
    const val =
      body.weight_kg !== undefined
        ? body.weight_kg
        : body.weightKg !== undefined
        ? body.weightKg
        : body.actual_weight_kg !== undefined
        ? body.actual_weight_kg
        : body.actualWeightKg;
    cleaned.weight_kg = val !== null && val !== undefined && val !== '' ? Number(val) : null;
  }
  if (
    body.shipping_cost !== undefined ||
    body.shippingCost !== undefined ||
    body.customer_shipping !== undefined ||
    body.customerShipping !== undefined
  ) {
    const val =
      body.shipping_cost !== undefined
        ? body.shipping_cost
        : body.shippingCost !== undefined
        ? body.shippingCost
        : body.customer_shipping !== undefined
        ? body.customer_shipping
        : body.customerShipping;
    cleaned.shipping_cost = val !== null && val !== undefined && val !== '' ? Number(val) : 0;
  }
  if (
    body.actual_shipping_cost !== undefined ||
    body.actualShippingCost !== undefined
  ) {
    const val =
      body.actual_shipping_cost !== undefined
        ? body.actual_shipping_cost
        : body.actualShippingCost;
    cleaned.actual_shipping_cost =
      val !== null && val !== undefined && val !== '' ? Number(val) : null;
  }
  if (
    body.shipping_cost_difference !== undefined ||
    body.shippingCostDifference !== undefined
  ) {
    const val =
      body.shipping_cost_difference !== undefined
        ? body.shipping_cost_difference
        : body.shippingCostDifference;
    cleaned.shipping_cost_difference =
      val !== null && val !== undefined && val !== '' ? Number(val) : null;
  }
  if (body.shipped_at !== undefined || body.shippedAt !== undefined) {
    const val = body.shipped_at !== undefined ? body.shipped_at : body.shippedAt;
    cleaned.shipped_at = val ? new Date(val) : null;
  }
  if (body.packed_at !== undefined || body.packedAt !== undefined) {
    const val = body.packed_at !== undefined ? body.packed_at : body.packedAt;
    cleaned.packed_at = val ? new Date(val) : null;
  }
  if (body.status !== undefined) {
    let s = body.status;
    if (s === 'COMPLETED') s = 'DELIVERED';
    cleaned.status = s;
  }
  if (
    body.proof_before_url !== undefined ||
    body.proofBeforeUrl !== undefined
  ) {
    const val =
      body.proof_before_url !== undefined
        ? body.proof_before_url
        : body.proofBeforeUrl;
    cleaned.proof_before_url = val ? String(val).trim() : null;
  }
  if (
    body.proof_url !== undefined ||
    body.proofUrl !== undefined ||
    body.photo_url !== undefined ||
    body.photoUrl !== undefined
  ) {
    const val =
      body.proof_url !== undefined
        ? body.proof_url
        : body.proofUrl !== undefined
        ? body.proofUrl
        : body.photo_url !== undefined
        ? body.photo_url
        : body.photoUrl;
    cleaned.proof_url = val ? String(val).trim() : null;
  }
  if (body.notes !== undefined) {
    cleaned.notes = body.notes ? String(body.notes).trim() : null;
  }
  if (body.shipping_method !== undefined || body.shippingMethod !== undefined) {
    const val = body.shipping_method !== undefined ? body.shipping_method : body.shippingMethod;
    cleaned.shipping_method = val ? String(val).trim() : 'MANUAL';
  }
  if (body.shopee_username !== undefined || body.shopeeUsername !== undefined) {
    const val = body.shopee_username !== undefined ? body.shopee_username : body.shopeeUsername;
    cleaned.shopee_username = val ? String(val).trim() : null;
  }
  if (
    body.shopee_refund_amount !== undefined ||
    body.shopeeRefundAmount !== undefined
  ) {
    const val =
      body.shopee_refund_amount !== undefined
        ? body.shopee_refund_amount
        : body.shopeeRefundAmount;
    cleaned.shopee_refund_amount =
      val !== null && val !== undefined && val !== '' ? Number(val) : null;
  }

  return cleaned;
}
