import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MigrationBundle,
  MigrationRecord,
  MigrationStep,
  SourceConfig,
  WordPressConfig,
} from "./types.js";

export interface PipelineContext {
  migration: MigrationRecord;
  source: SourceConfig;
  destination?: WordPressConfig;
  artifactDirectory: string;
  artifactStore?: ArtifactStore;
  artifactPrefix?: string;
}

export interface ArtifactStore {
  readJson<T>(key: string): Promise<T | undefined>;
  writeJson<T>(key: string, value: T): Promise<void>;
  location(key: string): string;
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly rootDirectory: string) {}

  async readJson<T>(key: string): Promise<T | undefined> {
    try {
      return JSON.parse(
        await readFile(path.join(this.rootDirectory, key), "utf8"),
      ) as T;
    } catch {
      return undefined;
    }
  }

  async writeJson<T>(key: string, value: T): Promise<void> {
    const file = path.join(this.rootDirectory, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2));
  }

  location(key: string): string {
    return path.join(this.rootDirectory, key);
  }
}

export interface PipelineServices {
  discover(context: PipelineContext): Promise<unknown>;
  extract(context: PipelineContext, discovery: unknown): Promise<unknown>;
  normalize(context: PipelineContext, extracted: unknown): Promise<MigrationBundle>;
  optimize(context: PipelineContext, bundle: MigrationBundle): Promise<MigrationBundle>;
  validate(context: PipelineContext, bundle: MigrationBundle): Promise<MigrationBundle>;
  importToWordPress?(
    context: PipelineContext,
    bundle: MigrationBundle,
  ): Promise<unknown>;
  verify?(
    context: PipelineContext,
    bundle: MigrationBundle,
    importResult: unknown,
  ): Promise<unknown>;
  onStep?(
    step: MigrationStep,
    state: "started" | "completed",
    artifact?: string,
  ): Promise<void>;
  beforeStep?(step: MigrationStep): Promise<void>;
}

async function artifact<T>(
  store: ArtifactStore,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const existing = await store.readJson<T>(key);
  if (existing !== undefined) return existing;
  const result = await compute();
  await store.writeJson(key, result);
  return result;
}

export async function runMigrationPipeline(
  context: PipelineContext,
  services: PipelineServices,
): Promise<MigrationBundle> {
  await mkdir(context.artifactDirectory, { recursive: true });
  const store =
    context.artifactStore ?? new FileArtifactStore(context.artifactDirectory);
  const prefix = context.artifactPrefix
    ? `${context.artifactPrefix.replace(/\/+$/, "")}/`
    : "";
  const execute = async <T>(
    step: MigrationStep,
    compute: () => Promise<T>,
  ): Promise<T> => {
    await services.beforeStep?.(step);
    await services.onStep?.(step, "started");
    const key = `${prefix}${step}.json`;
    const result = await artifact(store, key, compute);
    await services.onStep?.(
      step,
      "completed",
      store.location(key),
    );
    return result;
  };

  const discovery = await execute("discover", () => services.discover(context));
  const extracted = await execute("extract", () =>
    services.extract(context, discovery),
  );
  const normalized = await execute("normalize", () =>
    services.normalize(context, extracted),
  );
  const optimized = await execute("optimize", () =>
    services.optimize(context, normalized),
  );
  const validated = await execute("validate", () =>
    services.validate(context, optimized),
  );

  if (context.destination && services.importToWordPress) {
    const imported = await execute("import", () =>
      services.importToWordPress!(context, validated),
    );
    if (services.verify) {
      await execute("verify", () =>
        services.verify!(context, validated, imported),
      );
    }
  }
  return validated;
}
