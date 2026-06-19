import path from "node:path";
import { Worker } from "bullmq";
import {
  FileMigrationRepository,
  MigrationService,
} from "@np2wp/api";
import { PostgresMigrationRepository } from "@np2wp/database";
import { S3ArtifactStore } from "@np2wp/storage";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const encryptionKey =
  process.env.CREDENTIAL_ENCRYPTION_KEY ??
  Buffer.alloc(32, 11).toString("base64");
const repository =
  process.env.REPOSITORY_DRIVER === "postgres"
    ? new PostgresMigrationRepository({
        connectionString:
          process.env.DATABASE_URL ??
          "postgresql://np2wp:np2wp@localhost:5432/np2wp",
      })
    : new FileMigrationRepository(path.resolve("artifacts", "_control"));
if (repository instanceof PostgresMigrationRepository) {
  await repository.initialize();
}
const artifactStore =
  process.env.ARTIFACT_STORE === "s3"
    ? new S3ArtifactStore({
        bucket: process.env.OBJECT_STORAGE_BUCKET ?? "np2wp",
        endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY,
      })
    : undefined;
const service = new MigrationService(repository, encryptionKey, artifactStore);

const worker = new Worker<{ migrationId: string; tenantId: string }>(
  "np2wp-migrations",
  async (job) => {
    const migration = await repository.get(
      job.data.migrationId,
      job.data.tenantId,
    );
    if (!migration) throw new Error("Migration record no longer exists.");
    await service.run(migration);
    return { migrationId: migration.id, status: "completed" };
  },
  {
    connection: { url: redisUrl },
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
    limiter: {
      max: Number(process.env.WORKER_RATE_LIMIT_MAX ?? 4),
      duration: Number(process.env.WORKER_RATE_LIMIT_DURATION_MS ?? 1000),
    },
  },
);

worker.on("completed", (job) =>
  console.log(`Migration ${job.data.migrationId} completed.`),
);
worker.on("failed", (job, error) =>
  console.error(`Migration ${job?.data.migrationId ?? "unknown"} failed.`, error),
);

async function shutdown(): Promise<void> {
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`NP2WP worker listening with Redis ${redisUrl}`);
