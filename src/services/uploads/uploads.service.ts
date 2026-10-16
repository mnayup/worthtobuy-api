import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand,
  CreateBucketCommand, 
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
  DeleteBucketCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import type { Readable } from 'stream';

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly endpoint: string;
  private readonly port: number;
  private readonly protocol: string;
  private readonly logger = new Logger(UploadsService.name);

  constructor(private configService: ConfigService) {
    const rawEndpoint = this.configService.get<string>('MINIO_ENDPOINT') || 's3.jastip-worthtobuy.com';
    // Strip protocol (http:// or https://), trailing path, and port if user included them in MINIO_ENDPOINT
    const cleanEndpoint = rawEndpoint.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').split(':')[0] || 's3.jastip-worthtobuy.com';
    const port = Number(this.configService.get<number>('MINIO_PORT')) || 443;
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY') || 'minioadmin';
    const secretKey = this.configService.get<string>('MINIO_SECRET_KEY') || 'minioadmin';
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME') || 'worthtobuy';

    const useSsl = this.configService.get<string>('MINIO_USE_SSL') === 'true' || rawEndpoint.startsWith('https://') || port === 443;
    this.protocol = useSsl ? 'https' : 'http';
    this.endpoint = cleanEndpoint;
    this.port = port;

    const endpointUrl =
      (this.protocol === 'https' && this.port === 443) || (this.protocol === 'http' && this.port === 80)
        ? `${this.protocol}://${this.endpoint}`
        : `${this.protocol}://${this.endpoint}:${this.port}`;

    this.s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: endpointUrl,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit() {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`Bucket "${this.bucketName}" already exists.`);
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        this.logger.log(`Bucket "${this.bucketName}" not found. Creating it...`);
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
          this.logger.log(`Bucket "${this.bucketName}" created successfully.`);
        } catch (createError: any) {
          this.logger.error(`Failed to create bucket: ${createError.message}`);
        }
      } else {
        this.logger.warn(`Checking bucket returned: ${error.message}. Attempting create if needed...`);
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
        } catch (ignored: any) {}
      }
    }

    await this.configureBucketPolicy();
  }

  private async configureBucketPolicy() {
    try {
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicRead',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucketName}/*`],
          },
        ],
      };
      await this.s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucketName,
          Policy: JSON.stringify(policy),
        })
      );
      this.logger.log(`Public read policy applied to bucket "${this.bucketName}".`);
    } catch (err: any) {
      this.logger.warn(`Could not set public bucket policy: ${err.message}`);
    }

    try {
      await this.s3Client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucketName,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedHeaders: ['*'],
                AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
                AllowedOrigins: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        })
      );
      this.logger.log(`CORS configuration applied to bucket "${this.bucketName}".`);
    } catch (err: any) {
      if (err.name === 'NotImplemented' || err.Code === 'NotImplemented' || err.$metadata?.httpStatusCode === 501) {
        this.logger.log(`Bucket CORS handled by MinIO server/proxy.`);
      } else {
        this.logger.warn(`Could not set CORS configuration: ${err.message}`);
      }
    }
  }

  getPublicUrl(key: string): string {
    const minioPublicUrl = this.configService.get<string>('MINIO_PUBLIC_URL');
    if (minioPublicUrl) {
      return `${minioPublicUrl.replace(/\/+$/, '')}/${this.bucketName}/${key}`;
    }
    const endpointHost =
      (this.protocol === 'https' && this.port === 443) || (this.protocol === 'http' && this.port === 80)
        ? `${this.protocol}://${this.endpoint}`
        : `${this.protocol}://${this.endpoint}:${this.port}`;
    return `${endpointHost}/${this.bucketName}/${key}`;
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    contentType: string,
    entityType: string = 'misc'
  ) {
    const uniqueId = crypto.randomUUID();
    const cleanFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${entityType}/${uniqueId}-${cleanFilename}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await this.s3Client.send(command);
    const publicUrl = this.getPublicUrl(key);

    return {
      publicUrl,
      key,
    };
  }

  async getObjectStream(key: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const data = await this.s3Client.send(command);
    return {
      stream: data.Body as Readable,
      contentType: data.ContentType || 'application/octet-stream',
      contentLength: data.ContentLength,
      etag: data.ETag,
      lastModified: data.LastModified,
    };
  }

  async generatePresignedUrl(filename: string, contentType: string, entityType: string) {
    const uniqueId = crypto.randomUUID();
    const cleanFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${entityType}/${uniqueId}-${cleanFilename}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    const publicUrl = this.getPublicUrl(key);

    return {
      presignedUrl,
      publicUrl,
      key,
    };
  }

  extractKeyFromUrl(fileUrl: string): string | null {
    if (!fileUrl || typeof fileUrl !== 'string') return null;
    const trimmed = fileUrl.trim();
    if (!trimmed) return null;

    try {
      // Handles both absolute URLs (https://s3.domain.com/worthtobuy/products/uuid-file.jpg)
      // and relative paths (/uploads/file/products/uuid-file.jpg or products/uuid-file.jpg)
      let pathname = trimmed;
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const parsed = new URL(trimmed);
        pathname = parsed.pathname;
      }

      // Remove leading slashes
      pathname = pathname.replace(/^\/+/, '');

      // If URL pattern contains /uploads/file/<key>
      if (pathname.includes('uploads/file/')) {
        return pathname.substring(pathname.indexOf('uploads/file/') + 'uploads/file/'.length);
      }

      // If URL starts with bucketName/
      if (pathname.startsWith(`${this.bucketName}/`)) {
        return pathname.substring(this.bucketName.length + 1);
      }

      // If already a key like 'products/uuid-name.png' or 'brand/uuid-logo.png'
      if (/^(invoices|products|shipments|expenses|payments|purchases|brand|orders|misc)\//i.test(pathname)) {
        return pathname;
      }

      // Fallback: check if bucketName exists in segments
      const parts = pathname.split('/');
      const bucketIdx = parts.indexOf(this.bucketName);
      if (bucketIdx !== -1 && bucketIdx < parts.length - 1) {
        return parts.slice(bucketIdx + 1).join('/');
      }

      return null;
    } catch (e) {
      this.logger.warn(`Could not extract S3 key from url: ${fileUrl}`);
      return null;
    }
  }

  async deleteFile(key: string): Promise<boolean> {
    if (!key) return false;
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
      this.logger.log(`Deleted object "${key}" from bucket "${this.bucketName}"`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to delete object "${key}": ${err.message}`);
      return false;
    }
  }

  async deleteFileByUrl(fileUrl?: string | null): Promise<boolean> {
    if (!fileUrl) return false;
    const key = this.extractKeyFromUrl(fileUrl);
    if (!key) return false;
    return this.deleteFile(key);
  }

  async deleteFilesByUrl(urls?: (string | null | undefined)[]): Promise<void> {
    if (!urls || !Array.isArray(urls)) return;
    for (const url of urls) {
      if (url) {
        await this.deleteFileByUrl(url);
      }
    }
  }
}

