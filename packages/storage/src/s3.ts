import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ArtifactStore } from "@np2wp/core";

export interface S3ArtifactStoreOptions {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;

  constructor(private readonly options: S3ArtifactStoreOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region ?? "us-east-1",
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            }
          : undefined,
    });
  }

  async readJson<T>(key: string): Promise<T | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      const body = await response.Body?.transformToString();
      return body ? (JSON.parse(body) as T) : undefined;
    } catch (error) {
      if (
        error instanceof NoSuchKey ||
        (typeof error === "object" &&
          error !== null &&
          "$metadata" in error &&
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404)
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async writeJson<T>(key: string, value: T): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        ServerSideEncryption: this.options.endpoint ? undefined : "AES256",
      }),
    );
  }

  location(key: string): string {
    return `s3://${this.options.bucket}/${key}`;
  }
}
