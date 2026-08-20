import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class S3ObjectStore {
  constructor({ accessKeyId, bucket, endpoint, forcePathStyle = false, region, secretAccessKey, client, presign = getSignedUrl }) {
    this.bucket = bucket;
    this.presign = presign;
    this.client = client ?? new S3Client({
      endpoint: endpoint || undefined,
      forcePathStyle,
      region,
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
  }

  async createPutTicket({ byteSize, checksumBase64, mediaType, objectKey }) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: undefined,
      ContentLength: byteSize,
      ContentType: mediaType,
      ChecksumSHA256: checksumBase64,
    });
    return {
      expiresInSeconds: 300,
      headers: {
        'content-length': String(byteSize),
        'content-type': mediaType,
        'x-amz-checksum-sha256': checksumBase64,
      },
      url: await this.presign(this.client, command, { expiresIn: 300 }),
    };
  }

  async createGetTicket(objectKey) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ChecksumMode: 'ENABLED',
    });
    return {
      expiresInSeconds: 120,
      url: await this.presign(this.client, command, { expiresIn: 120 }),
    };
  }

  async head(objectKey) {
    const value = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey, ChecksumMode: 'ENABLED' }));
    return {
      byteSize: Number(value.ContentLength),
      checksumBase64: value.ChecksumSHA256 ?? null,
      mediaType: value.ContentType ?? null,
    };
  }

  async get(objectKey) {
    const value = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey, ChecksumMode: 'ENABLED' }));
    if (!value.Body) throw new Error('Object body is unavailable.');
    return { body: value.Body, byteSize: Number(value.ContentLength ?? 0), mediaType: value.ContentType ?? null };
  }
}
