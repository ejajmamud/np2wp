import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  encryptSecret,
  redactSecrets,
  sourceConfigSchema,
  wordpressConfigSchema,
  type MigrationRecord,
} from "@np2wp/core";
import { z } from "zod";
import { Queue } from "bullmq";
import { PostgresMigrationRepository } from "@np2wp/database";
import { S3ArtifactStore } from "@np2wp/storage";
import { dashboardHtml } from "./dashboard.js";
import { MigrationService } from "./migration-service.js";
import { FileMigrationRepository } from "./repository.js";

const app = Fastify({
  logger: {
    redact: [
      "req.headers.authorization",
      "*.password",
      "*.applicationPassword",
      "*.receiverToken",
    ],
  },
  bodyLimit: 2_000_000,
});
await app.register(cors, { origin: false });

const dataDirectory = path.resolve("artifacts", "_control");
const repository =
  process.env.REPOSITORY_DRIVER === "postgres"
    ? new PostgresMigrationRepository({
        connectionString:
          process.env.DATABASE_URL ??
          "postgresql://np2wp:np2wp@localhost:5432/np2wp",
      })
    : new FileMigrationRepository(dataDirectory);
if (repository instanceof PostgresMigrationRepository) {
  await repository.initialize();
}
const encryptionKey =
  process.env.CREDENTIAL_ENCRYPTION_KEY ??
  Buffer.alloc(32, 11).toString("base64");
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
const apiToken = process.env.API_TOKEN ?? "local-development-token";
const inline = process.env.RUN_JOBS_INLINE !== "false";

app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/api/")) return;
  if (request.headers.authorization !== `Bearer ${apiToken}`) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

const createSchema = z.object({
  name: z.string().min(2).max(120),
  source: sourceConfigSchema,
  destination: wordpressConfigSchema.optional(),
  priority: z.number().int().min(1).max(10).default(5),
});
const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  destination: wordpressConfigSchema.nullable().optional(),
});

function tenantId(headers: Record<string, unknown>): string {
  const value = headers["x-tenant-id"];
  return typeof value === "string" && value ? value : "default";
}

function assertPublicHttpUrl(raw: string): void {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    (isIP(host) === 4 &&
      /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
        host,
      ))
  ) {
    throw new Error("Private and loopback URLs are not allowed.");
  }
}

function publicRecord(record: MigrationRecord): Record<string, unknown> {
  const {
    encryptedPassword: _sourceSecret,
    ...source
  } = record.source;
  let destination: Record<string, unknown> | undefined;
  if (record.destination) {
    const {
      encryptedApplicationPassword: _applicationSecret,
      encryptedReceiverToken: _receiverSecret,
      ...safeDestination
    } = record.destination;
    destination = safeDestination;
  }
  return redactSecrets({ ...record, source, destination });
}

function addEvent(
  record: MigrationRecord,
  kind: MigrationRecord["events"][number]["kind"],
  message: string,
  metadata?: Record<string, unknown>,
): void {
  record.events ??= [];
  record.events.push({
    id: randomUUID(),
    kind,
    message,
    createdAt: new Date().toISOString(),
    step: record.currentStep,
    metadata,
  });
  record.events = record.events.slice(-250);
}

function migrationQueue(): Queue {
  return new Queue("np2wp-migrations", {
    connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
  });
}

async function enqueue(record: MigrationRecord): Promise<string> {
  const priority =
    Number.isInteger(record.priority) &&
    record.priority >= 1 &&
    record.priority <= 10
      ? record.priority
      : 5;
  record.priority = priority;
  record.events ??= [];
  record.runAttempt = Number.isInteger(record.runAttempt)
    ? record.runAttempt + 1
    : 1;
  record.status = "queued";
  record.controlRequested = undefined;
  record.error = undefined;
  record.updatedAt = new Date().toISOString();
  const jobId = `${record.id}-${record.runAttempt}`;
  addEvent(record, "queued", `Run ${record.runAttempt} queued.`, {
    jobId,
    priority,
  });
  await repository.save(record);

  if (inline) {
    void service.run(record).catch((error) => app.log.error(error));
    return jobId;
  }

  const queue = migrationQueue();
  try {
    await queue.add(
      "run-migration",
      {
        migrationId: record.id,
        tenantId: record.tenantId,
        runAttempt: record.runAttempt,
      },
      {
        jobId,
        priority: 11 - priority,
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  } catch (error) {
    record.status = "failed";
    record.error = `Queue submission failed: ${error instanceof Error ? error.message : String(error)}`;
    record.updatedAt = new Date().toISOString();
    addEvent(record, "failed", record.error);
    await repository.save(record);
    throw error;
  } finally {
    await queue.close();
  }
  return jobId;
}

app.get("/", async (_request, reply) =>
  reply.type("text/html; charset=utf-8").send(dashboardHtml),
);
app.get("/health", async () => ({ ok: true, service: "np2wp-api" }));

app.get("/api/migrations", async (request) => {
  const records = await repository.list(tenantId(request.headers));
  return records.map(publicRecord);
});

app.get("/api/migrations/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const record = await repository.get(id, tenantId(request.headers));
  if (!record) return reply.code(404).send({ error: "Migration not found" });
  return publicRecord(record);
});

app.post("/api/migrations", async (request, reply) => {
  const input = createSchema.parse(request.body);
  assertPublicHttpUrl(input.source.publicUrl);
  if (input.source.cmsLoginUrl) assertPublicHttpUrl(input.source.cmsLoginUrl);
  if (input.destination) assertPublicHttpUrl(input.destination.baseUrl);
  const now = new Date().toISOString();
  const id = randomUUID();
  const record: MigrationRecord = {
    id,
    tenantId: tenantId(request.headers),
    name: input.name,
    source: {
      publicUrl: input.source.publicUrl,
      cmsLoginUrl: input.source.cmsLoginUrl,
      username: input.source.username,
      mode: input.source.mode,
      encryptedPassword: input.source.password
        ? encryptSecret(input.source.password, encryptionKey)
        : undefined,
    },
    destination: input.destination
      ? {
          baseUrl: input.destination.baseUrl,
          username: input.destination.username,
          publishMode: input.destination.publishMode,
          encryptedApplicationPassword: input.destination.applicationPassword
            ? encryptSecret(input.destination.applicationPassword, encryptionKey)
            : undefined,
          encryptedReceiverToken: input.destination.receiverToken
            ? encryptSecret(input.destination.receiverToken, encryptionKey)
            : undefined,
        }
      : undefined,
    status: "draft",
    priority: input.priority,
    runAttempt: 0,
    events: [],
    checkpoints: {},
    artifactDirectory: service.artifactDirectory(id),
    createdAt: now,
    updatedAt: now,
  };
  addEvent(record, "created", "Migration created.");
  await repository.save(record);
  return reply.code(201).send(publicRecord(record));
});

app.post("/api/migrations/:id/start", async (request, reply) => {
  const { id } = request.params as { id: string };
  const record = await repository.get(id, tenantId(request.headers));
  if (!record) return reply.code(404).send({ error: "Migration not found" });
  if (["running", "cancelling"].includes(record.status)) {
    return reply.code(409).send({ error: "Migration already running" });
  }
  const jobId = await enqueue(record);
  return reply.code(202).send({ id, jobId, status: "queued" });
});

app.patch("/api/migrations/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const input = updateSchema.parse(request.body);
  const record = await repository.get(id, tenantId(request.headers));
  if (!record) return reply.code(404).send({ error: "Migration not found" });
  if (["running", "cancelling"].includes(record.status)) {
    return reply.code(409).send({ error: "Stop the migration before editing it" });
  }
  if (input.name !== undefined) record.name = input.name;
  if (input.priority !== undefined) record.priority = input.priority;
  if (input.destination === null) record.destination = undefined;
  else if (input.destination) {
    assertPublicHttpUrl(input.destination.baseUrl);
    record.destination = {
      baseUrl: input.destination.baseUrl,
      username: input.destination.username,
      publishMode: input.destination.publishMode,
      encryptedApplicationPassword: input.destination.applicationPassword
        ? encryptSecret(input.destination.applicationPassword, encryptionKey)
        : undefined,
      encryptedReceiverToken: input.destination.receiverToken
        ? encryptSecret(input.destination.receiverToken, encryptionKey)
        : undefined,
    };
  }
  record.updatedAt = new Date().toISOString();
  addEvent(record, "updated", "Migration settings updated.");
  await repository.save(record);
  return publicRecord(record);
});

app.delete("/api/migrations/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const record = await repository.get(id, tenantId(request.headers));
  if (!record) return reply.code(404).send({ error: "Migration not found" });
  if (["running", "cancelling"].includes(record.status)) {
    return reply.code(409).send({ error: "Cancel the migration before deleting it" });
  }
  await repository.delete(id, record.tenantId);
  return reply.code(204).send();
});

app.post("/api/migrations/:id/pause", async (request, reply) => {
  const { id } = request.params as { id: string };
  const record = await repository.get(id, tenantId(request.headers));
  if (!record) return reply.code(404).send({ error: "Migration not found" });
  if (record.status !== "running") {
    return reply.code(409).send({ error: "Only a running migration can be paused" });
  }
  record.controlRequested = "pause";
  record.updatedAt = new Date().toISOString();
  addEvent(record, "updated", "Pause requested; it will stop at the next safe checkpoint.");
  await repository.save(record);
  return reply.code(202).send({ id, status: record.status, controlRequested: "pause" });
});

app.post("/api/migrations/:id/cancel", async (request, reply) => {
  const { id } = request.params as { id: string };
  const record = await repository.get(id, tenantId(request.headers));
  if (!record) return reply.code(404).send({ error: "Migration not found" });
  if (record.status === "queued" && !inline) {
    const queue = migrationQueue();
    try {
      const job = await queue.getJob(`${record.id}-${record.runAttempt}`);
      if (job) await job.remove();
    } finally {
      await queue.close();
    }
    record.status = "cancelled";
    record.controlRequested = undefined;
    addEvent(record, "cancelled", "Queued migration cancelled.");
  } else if (record.status === "running") {
    record.status = "cancelling";
    record.controlRequested = "cancel";
    addEvent(record, "updated", "Cancellation requested; it will stop at the next safe checkpoint.");
  } else {
    return reply.code(409).send({ error: "Migration is not queued or running" });
  }
  record.updatedAt = new Date().toISOString();
  await repository.save(record);
  return reply.code(202).send({ id, status: record.status });
});

app.get("/api/system/status", async (_request, reply) => {
  if (inline) return { mode: "inline", queue: null };
  const queue = migrationQueue();
  try {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
    );
    return { mode: "distributed", queue: counts, checkedAt: new Date().toISOString() };
  } catch (error) {
    return reply.code(503).send({
      mode: "distributed",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await queue.close();
  }
});

app.get("/api/migrations/:id/events", async (request, reply) => {
  const { id } = request.params as { id: string };
  const record = await repository.get(id, tenantId(request.headers));
  if (!record) return reply.code(404).send({ error: "Migration not found" });
  return record.events ?? [];
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: "Invalid request", issues: error.issues });
  }
  const httpError = error as {
    statusCode?: unknown;
    message?: unknown;
    code?: unknown;
  };
  if (typeof httpError.statusCode === "number") {
    return reply.code(httpError.statusCode).send({
      error:
        typeof httpError.message === "string"
          ? httpError.message
          : "Request failed",
      code: typeof httpError.code === "string" ? httpError.code : undefined,
    });
  }
  app.log.error(error);
  return reply.code(500).send({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 4300);
await app.listen({ port, host: "0.0.0.0" });
