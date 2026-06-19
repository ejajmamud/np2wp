import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MigrationRecord } from "@np2wp/core";

export interface MigrationRepository {
  list(tenantId: string): Promise<MigrationRecord[]>;
  get(id: string, tenantId: string): Promise<MigrationRecord | undefined>;
  save(record: MigrationRecord): Promise<void>;
}

export class FileMigrationRepository implements MigrationRepository {
  private readonly file: string;
  private writes = Promise.resolve();

  constructor(directory: string) {
    this.file = path.join(directory, "migrations.json");
  }

  private async all(): Promise<MigrationRecord[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as MigrationRecord[];
    } catch {
      return [];
    }
  }

  async list(tenantId: string): Promise<MigrationRecord[]> {
    return (await this.all())
      .filter((record) => record.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string, tenantId: string): Promise<MigrationRecord | undefined> {
    return (await this.all()).find(
      (record) => record.id === id && record.tenantId === tenantId,
    );
  }

  async save(record: MigrationRecord): Promise<void> {
    this.writes = this.writes.then(async () => {
      const records = await this.all();
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(records, null, 2));
      await rename(temporary, this.file);
    });
    return this.writes;
  }
}
