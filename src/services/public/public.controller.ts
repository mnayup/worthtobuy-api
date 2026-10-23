import { Controller, Get, Post, Patch, Param, Query, Body } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) { }

  @Get('overview')
  async getOverview() {
    return this.publicService.getOverview();
  }

  @Get('events')
  async getEvents(@Query() query: any) {
    return this.publicService.getEvents(query);
  }

  @Get('events/:id')
  async getEventDetail(@Param('id') id: string) {
    return this.publicService.getEventDetail(Number(id));
  }

  @Get('products/ready-stock')
  async getReadyStock(@Query() query: any) {
    return this.publicService.getReadyStock(query);
  }

  @Get('products/:id')
  async getProductDetail(@Param('id') id: string) {
    return this.publicService.getProductDetail(Number(id));
  }

  @Get('track/:identifier')
  async trackOrder(@Param('identifier') identifier: string) {
    return this.publicService.trackOrder(identifier);
  }

  @Get('invoices/:invoiceNumber')
  async getInvoiceDetail(@Param('invoiceNumber') invoiceNumber: string) {
    return this.publicService.getPublicInvoice(invoiceNumber);
  }

  @Post('invoices/:invoiceNumber/payments')
  async submitPaymentProof(
    @Param('invoiceNumber') invoiceNumber: string,
    @Body() body: any
  ) {
    return this.publicService.submitPublicPaymentProof(invoiceNumber, body);
  }

  @Patch('invoices/:invoiceNumber/shipping-method')
  async updateShippingMethod(
    @Param('invoiceNumber') invoiceNumber: string,
    @Body() body: any
  ) {
    return this.publicService.updatePublicShippingMethod(invoiceNumber, body);
  }
}
