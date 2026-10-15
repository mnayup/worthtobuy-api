import { 
  Controller, 
  Post, 
  Get, 
  Body, 
  Req, 
  Res, 
  UploadedFile, 
  UseInterceptors, 
  BadRequestException, 
  NotFoundException, 
  Logger 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { UploadsService } from './uploads.service';

class PresignedUrlDto {
  filename: string;
  contentType: string;
  entityType: string;
}

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: any;
}

@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  }))
  async uploadFile(
    @UploadedFile() file: MulterFile,
    @Body('entityType') entityType?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded or file field missing');
    }
    const resolvedEntityType = entityType || 'misc';
    return this.uploadsService.uploadBuffer(
      file.buffer,
      file.originalname,
      file.mimetype,
      resolvedEntityType
    );
  }

  @Post('presigned-url')
  async getPresignedUrl(@Body() dto: PresignedUrlDto) {
    return this.uploadsService.generatePresignedUrl(
      dto.filename,
      dto.contentType,
      dto.entityType
    );
  }

  @Get('file/*')
  async serveFile(@Req() req: Request, @Res() res: Response) {
    const key = (req.params as any)?.[0] || (req.params as any)?.['0'] || req.url.replace(/^\/?(api\/)?uploads\/file\//, '').split('?')[0];
    if (!key) {
      throw new BadRequestException('File key is missing');
    }

    try {
      const file = await this.uploadsService.getObjectStream(key);

      if (file.etag && req.headers['if-none-match'] === file.etag) {
        return res.status(304).end();
      }

      res.setHeader('Content-Type', file.contentType);
      if (file.contentLength) {
        res.setHeader('Content-Length', file.contentLength);
      }
      if (file.etag) {
        res.setHeader('ETag', file.etag);
      }
      if (file.lastModified) {
        res.setHeader('Last-Modified', file.lastModified.toUTCString());
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      (file.stream as any).pipe(res);
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException(`File not found: ${key}`);
      }
      this.logger.error(`Failed to retrieve file ${key}: ${err.message}`);
      res.status(500).json({ message: 'Error retrieving file' });
    }
  }
}

