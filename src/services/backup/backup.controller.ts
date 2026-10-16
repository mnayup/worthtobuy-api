import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settings/backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('logs')
  @Roles('OWNER', 'ADMIN')
  async getLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.backupService.getLogs(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get('download')
  @Roles('OWNER')
  async downloadBackup(
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { filePath, filename, fileSizeBytes } = await this.backupService.createBackup(user);

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', fileSizeBytes);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('close', () => {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (ignored) {}
      }
    });

    fileStream.on('error', (err) => {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (ignored) {}
      }
    });
  }

  @Post('restore')
  @Roles('OWNER')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max dump file
  }))
  async restoreBackup(
    @UploadedFile() file: MulterFile,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('No backup file uploaded (.sql or .sql.gz required).');
    }

    const isValidExt = /\.(sql|sql\.gz|dump|tar)$/i.test(file.originalname);
    if (!isValidExt) {
      throw new BadRequestException('Invalid file extension. Please upload a .sql or .sql.gz database dump.');
    }

    return this.backupService.restoreDatabase(file.buffer, file.originalname, user);
  }
}
