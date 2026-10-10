import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Terjadi kesalahan pada server.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: any = exception.getResponse();
      message = typeof res === 'string' ? res : res?.message || exception.message;
    } else if (exception?.name === 'ZodError') {
      status = HttpStatus.BAD_REQUEST;
      message = exception.errors?.[0]?.message || 'Validasi data gagal.';
    } else if (exception?.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      message = 'Data dengan nilai unik yang sama sudah ada di sistem.';
    } else if (exception?.code === 'P2025') {
      status = HttpStatus.NOT_FOUND;
      message = 'Data yang diminta tidak ditemukan.';
    } else if (exception?.statusCode) {
      status = exception.statusCode;
      message = exception.message;
    } else if (exception?.message) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(exception?.stack || exception);
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: exception?.name || 'Error',
      timestamp: new Date().toISOString(),
    });
  }
}
