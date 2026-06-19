import path from "node:path";
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
    record.error = undefined;
    record.updatedAt = new Date().toISOString();
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
            await this.repository.save(record);
          },
        },
      );
      record.status = "completed";
      record.updatedAt = new Date().toISOString();
      await this.repository.save(record);
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = new Date().toISOString();
      await this.repository.save(record);
      throw error;
    }
  }

  artifactDirectory(id: string): string {
    return path.resolve("artifacts", id);
  }
}
