import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  S3Client, 
  PutObjectCommand, 
  CreateBucketCommand, 
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly endpoint: string;
  private readonly port: number;
  private readonly protocol: string;
  private readonly logger = new Logger(UploadsService.name);

  constructor(private configService: ConfigService) {
    const rawEndpoint = this.configService.get<string>('MINIO_ENDPOINT') || 'localhost';
    // Strip protocol (http:// or https://), trailing path, and port if user included them in MINIO_ENDPOINT
    const cleanEndpoint = rawEndpoint.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').split(':')[0] || 'localhost';
    const port = Number(this.configService.get<number>('MINIO_PORT')) || 9000;
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY') || 'minioadmin';
    const secretKey = this.configService.get<string>('MINIO_SECRET_KEY') || 'minioadmin';
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME') || 'worthtobuy';

    const useSsl = this.configService.get<string>('MINIO_USE_SSL') === 'true' || rawEndpoint.startsWith('https://');
    this.protocol = useSsl ? 'https' : 'http';
    this.endpoint = cleanEndpoint;
    this.port = port;

    this.s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: `${this.protocol}://${this.endpoint}:${this.port}`,
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
      if (err.name !== 'NotImplemented' && err.Code !== 'NotImplemented') {
        this.logger.warn(`Could not set CORS configuration: ${err.message}`);
      }
    }
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
    const publicUrl = `${this.protocol}://${this.endpoint}:${this.port}/${this.bucketName}/${key}`;

    return {
      presignedUrl,
      publicUrl,
      key,
    };
  }
}
