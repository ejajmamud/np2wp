import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  decryptSecret,
  runMigrationPipeline,
  type ArtifactStore,
  type MigrationBundle,
  type MigrationRecord,
  type MigrationStep,
  type SourceConfig,
  type WordPressConfig,
} from "@np2wp/core";
import {
  discoverNewpages,
  extractNewpages,
  normalizeNewpages,
  type NewpagesDiscovery,
  type NewpagesExtraction,
} from "@np2wp/newpages-adapter";
import { WordPressClient } from "@np2wp/wordpress-client";
import type { MigrationRepository } from "./repository.js";

class MigrationControlError extends Error {
  constructor(readonly action: "pause" | "cancel") {
    super(action === "pause" ? "Migration paused by operator." : "Migration cancelled by operator.");
  }
}

function appendEvent(
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

function validateBundle(bundle: MigrationBundle): MigrationBundle {
  const warnings = [...bundle.warnings];
  if (!bundle.pages.length) warnings.push("No company pages were normalized.");
  if (!bundle.products.length)
    warnings.push("No authenticated products were normalized.");
  const duplicateTargets = new Set<string>();
  for (const entity of [...bundle.pages, ...bundle.products]) {
    if (duplicateTargets.has(entity.canonicalUrl)) {
      throw new Error(`Duplicate target URL: ${entity.canonicalUrl}`);
    }
    duplicateTargets.add(entity.canonicalUrl);
  }
  return { ...bundle, warnings };
}

export class MigrationService {
  constructor(
    private readonly repository: MigrationRepository,
    private readonly encryptionKey: string,
    private readonly artifactStore?: ArtifactStore,
  ) {}

  async run(record: MigrationRecord): Promise<void> {
    const source: SourceConfig = {
      ...record.source,
      password: record.source.encryptedPassword
        ? decryptSecret(record.source.encryptedPassword, this.encryptionKey)
        : undefined,
    };
    delete (source as Record<string, unknown>).encryptedPassword;
    let destination: WordPressConfig | undefined;
    if (record.destination) {
      destination = {
        ...record.destination,
        applicationPassword: record.destination.encryptedApplicationPassword
          ? decryptSecret(
              record.destination.encryptedApplicationPassword,
              this.encryptionKey,
            )
          : undefined,
        receiverToken: record.destination.encryptedReceiverToken
          ? decryptSecret(
              record.destination.encryptedReceiverToken,
              this.encryptionKey,
            )
          : undefined,
      };
      delete (destination as Record<string, unknown>).encryptedApplicationPassword;
      delete (destination as Record<string, unknown>).encryptedReceiverToken;
    }

    record.status = "running";
    record.controlRequested = undefined;
    record.error = undefined;
    record.startedAt = new Date().toISOString();
    record.completedAt = undefined;
    record.updatedAt = record.startedAt;
    appendEvent(record, "started", `Run ${record.runAttempt} started.`);
    await this.repository.save(record);
    try {
      await runMigrationPipeline(
        {
          migration: record,
          source,
          destination,
          artifactDirectory: record.artifactDirectory,
          artifactStore: this.artifactStore,
          artifactPrefix: this.artifactStore ? `migrations/${record.id}` : undefined,
        },
        {
          discover: ({ source: config }) => discoverNewpages(config.publicUrl),
          extract: ({ source: config }, discovery) =>
            extractNewpages(config, discovery as NewpagesDiscovery),
          normalize: async ({ destination: target }, extracted) =>
            normalizeNewpages(
              extracted as NewpagesExtraction,
              target?.baseUrl ?? new URL(record.source.publicUrl).origin,
            ),
          optimize: async (_context, bundle) => bundle,
          validate: async (_context, bundle) => validateBundle(bundle),
          importToWordPress: destination
            ? async (_context, bundle) =>
                new WordPressClient(destination!).importBundle(bundle)
            : undefined,
          verify: destination
            ? async (_context, bundle, imported) => ({
                source: {
                  pages: bundle.pages.length,
                  products: bundle.products.length,
                },
                destination: imported,
                verifiedAt: new Date().toISOString(),
              })
            : undefined,
          beforeStep: async (step) => {
            const latest = await this.repository.get(record.id, record.tenantId);
            if (latest?.controlRequested) {
              record.controlRequested = latest.controlRequested;
              throw new MigrationControlError(latest.controlRequested);
            }
            record.currentStep = step;
          },
          onStep: async (
            step: MigrationStep,
            state: "started" | "completed",
            checkpoint?: string,
          ) => {
            record.currentStep = step;
            record.progress = {
              step,
              completed: state === "completed" ? 1 : 0,
              total: 1,
              message: `${state === "completed" ? "Completed" : "Running"} ${step}`,
              updatedAt: new Date().toISOString(),
            };
            if (checkpoint) record.checkpoints[step] = checkpoint;
            record.updatedAt = new Date().toISOString();
            appendEvent(
              record,
              "progress",
              record.progress.message,
              { completed: record.progress.completed, total: record.progress.total },
            );
            await this.repository.save(record);
          },
        },
      );
      record.status = "completed";
      record.progress = record.currentStep
        ? {
            step: record.currentStep,
            completed: 1,
            total: 1,
            message: "Migration completed",
            updatedAt: new Date().toISOString(),
          }
        : record.progress;
      record.completedAt = new Date().toISOString();
      record.updatedAt = record.completedAt;
      appendEvent(record, "completed", "Migration completed successfully.");
      await this.repository.save(record);
    } catch (error) {
      if (error instanceof MigrationControlError) {
        record.status = error.action === "pause" ? "paused" : "cancelled";
        record.controlRequested = undefined;
        record.error = undefined;
        record.updatedAt = new Date().toISOString();
        appendEvent(
          record,
          error.action === "pause" ? "paused" : "cancelled",
          error.message,
        );
        await this.repository.save(record);
        return;
      }
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = new Date().toISOString();
      appendEvent(record, "failed", record.error);
      await this.repository.save(record);
      throw error;
    }
  }

  artifactDirectory(id: string): string {
    return path.resolve("artifacts", id);
  }
}
