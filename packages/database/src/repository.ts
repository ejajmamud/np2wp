import { Pool } from "pg";
import type { MigrationRecord } from "@np2wp/core";

export interface PostgresRepositoryOptions {
  connectionString: string;
  maxConnections?: number;
}

export class PostgresMigrationRepository {
  private readonly pool: Pool;

  constructor(options: PostgresRepositoryOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id uuid PRIMARY KEY,
        tenant_id text NOT NULL,
        status text NOT NULL,
        name text NOT NULL,
        record jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS migrations_tenant_created_idx
        ON migrations (tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS migrations_status_updated_idx
        ON migrations (status, updated_at);
    `);
  }

  async list(tenantId: string): Promise<MigrationRecord[]> {
    const result = await this.pool.query<{ record: MigrationRecord }>(
      `SELECT record FROM migrations
       WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => row.record);
  }

  async get(id: string, tenantId: string): Promise<MigrationRecord | undefined> {
    const result = await this.pool.query<{ record: MigrationRecord }>(
      `SELECT record FROM migrations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return result.rows[0]?.record;
  }

  async save(record: MigrationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO migrations
        (id, tenant_id, status, name, record, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        status = EXCLUDED.status,
        name = EXCLUDED.name,
        record = EXCLUDED.record,
        updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.tenantId,
        record.status,
        record.name,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
