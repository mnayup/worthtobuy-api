import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

class PresignedUrlDto {
  filename: string;
  contentType: string;
  entityType: string;
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) { }

  @Post('presigned-url')
  async getPresignedUrl(@Body() dto: PresignedUrlDto) {
    return this.uploadsService.generatePresignedUrl(
      dto.filename,
      dto.contentType,
      dto.entityType
    );
  }
}
