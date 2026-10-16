import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../config/prisma/prisma.service';

const execAsync = promisify(exec);

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private isBusy = false;

  constructor(private prisma: PrismaService) {}

  async getLogs(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [total, logs] = await Promise.all([
      this.prisma.database_backup_log.count(),
      this.prisma.database_backup_log.findMany({
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    // Format BigInt to Number/String for JSON serialization
    const formattedLogs = logs.map((log) => ({
      ...log,
      file_size_bytes: log.file_size_bytes ? Number(log.file_size_bytes) : 0,
    }));

    return {
      total,
      page,
      limit,
      logs: formattedLogs,
    };
  }

  async createBackup(user?: { id?: number; name?: string; email?: string }): Promise<{
    filePath: string;
    filename: string;
    fileSizeBytes: number;
  }> {
    if (this.isBusy) {
      throw new BadRequestException('A backup or restore operation is already in progress.');
    }

    this.isBusy = true;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `worthtobuy_backup_${timestamp}.sql.gz`;
    const tempFilePath = path.join(os.tmpdir(), filename);

    const triggeredBy = user?.name || user?.email || 'Administrator';
    const userId = user?.id;

    try {
      this.logger.log(`Starting database backup to ${tempFilePath}...`);
      const dbUser = process.env.POSTGRES_USER || 'postgres';
      const dbName = process.env.POSTGRES_DB || 'worthtobuy_db';

      let dumpCmd = `docker exec worthtobuy-db-pgsql pg_dump -U ${dbUser} ${dbName} | gzip > "${tempFilePath}"`;

      try {
        await execAsync(dumpCmd);
      } catch (dockerErr) {
        this.logger.warn(`Docker pg_dump failed (${dockerErr}), attempting local pg_dump...`);
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) throw dockerErr;
        dumpCmd = `pg_dump "${dbUrl}" | gzip > "${tempFilePath}"`;
        await execAsync(dumpCmd);
      }

      const fileStats = fs.statSync(tempFilePath);
      if (fileStats.size === 0) {
        throw new Error('Database dump generated an empty file.');
      }

      // Record successful backup log
      await this.prisma.database_backup_log.create({
        data: {
          operation_type: 'BACKUP',
          filename,
          file_size_bytes: BigInt(fileStats.size),
          status: 'SUCCESS',
          triggered_by: triggeredBy,
          user_id: userId,
          notes: `Manual database backup created (${(fileStats.size / (1024 * 1024)).toFixed(2)} MB)`,
        },
      });

      this.logger.log(`Backup completed successfully (${filename}, ${fileStats.size} bytes)`);

      return {
        filePath: tempFilePath,
        filename,
        fileSizeBytes: fileStats.size,
      };
    } catch (err: any) {
      this.logger.error(`Backup failed: ${err.message}`, err.stack);

      await this.prisma.database_backup_log.create({
        data: {
          operation_type: 'BACKUP',
          filename,
          file_size_bytes: BigInt(0),
          status: 'FAILED',
          triggered_by: triggeredBy,
          user_id: userId,
          error_message: err.message || 'Unknown backup error',
        },
      });

      throw new BadRequestException(`Backup failed: ${err.message}`);
    } finally {
      this.isBusy = false;
    }
  }

  async restoreDatabase(
    fileBuffer: Buffer,
    originalFilename: string,
    user?: { id?: number; name?: string; email?: string }
  ): Promise<{ success: boolean; message: string }> {
    if (this.isBusy) {
      throw new BadRequestException('A backup or restore operation is already in progress.');
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Empty backup file provided for restore.');
    }

    this.isBusy = true;
    const tempRestorePath = path.join(os.tmpdir(), `restore_${Date.now()}_${originalFilename}`);
    fs.writeFileSync(tempRestorePath, fileBuffer);

    const triggeredBy = user?.name || user?.email || 'Administrator';
    const userId = user?.id;

    try {
      this.logger.log(`Starting database restore from file: ${originalFilename} (${fileBuffer.length} bytes)...`);

      const dbUser = process.env.POSTGRES_USER || 'postgres';
      const dbName = process.env.POSTGRES_DB || 'worthtobuy_db';

      const isGzip = originalFilename.endsWith('.gz') || fileBuffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));

      let restoreCmd = isGzip
        ? `gunzip -c "${tempRestorePath}" | docker exec -i worthtobuy-db-pgsql psql -U ${dbUser} -d ${dbName}`
        : `cat "${tempRestorePath}" | docker exec -i worthtobuy-db-pgsql psql -U ${dbUser} -d ${dbName}`;

      try {
        await execAsync(restoreCmd);
      } catch (dockerErr) {
        this.logger.warn(`Docker restore failed (${dockerErr}), attempting local psql restore...`);
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) throw dockerErr;
        restoreCmd = isGzip
          ? `gunzip -c "${tempRestorePath}" | psql "${dbUrl}"`
          : `psql "${dbUrl}" < "${tempRestorePath}"`;
        await execAsync(restoreCmd);
      }

      // Record successful restore log
      await this.prisma.database_backup_log.create({
        data: {
          operation_type: 'RESTORE',
          filename: originalFilename,
          file_size_bytes: BigInt(fileBuffer.length),
          status: 'SUCCESS',
          triggered_by: triggeredBy,
          user_id: userId,
          notes: `Database restored successfully from ${originalFilename}`,
        },
      });

      this.logger.log(`Database restore completed successfully.`);

      return {
        success: true,
        message: `Database restored successfully from file: ${originalFilename}.`,
      };
    } catch (err: any) {
      this.logger.error(`Database restore failed: ${err.message}`, err.stack);

      await this.prisma.database_backup_log.create({
        data: {
          operation_type: 'RESTORE',
          filename: originalFilename,
          file_size_bytes: BigInt(fileBuffer.length),
          status: 'FAILED',
          triggered_by: triggeredBy,
          user_id: userId,
          error_message: err.message || 'Unknown restore error',
        },
      });

      throw new BadRequestException(`Restore failed: ${err.message}`);
    } finally {
      this.isBusy = false;
      if (fs.existsSync(tempRestorePath)) {
        try {
          fs.unlinkSync(tempRestorePath);
        } catch (ignored) {}
      }
    }
  }
}
