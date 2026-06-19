CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'audit',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  PRIMARY KEY (tenant_id, user_id)
);

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

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  migration_id uuid,
  actor_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_migration_idx
  ON audit_events (migration_id, created_at);
