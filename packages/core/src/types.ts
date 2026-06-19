import { z } from "zod";

export const migrationStepSchema = z.enum([
  "discover",
  "extract",
  "normalize",
  "optimize",
  "validate",
  "import",
  "verify",
]);
export type MigrationStep = z.infer<typeof migrationStepSchema>;

export const migrationStatusSchema = z.enum([
  "draft",
  "queued",
  "running",
  "paused",
  "cancelling",
  "needs_input",
  "failed",
  "completed",
  "cancelled",
]);
export type MigrationStatus = z.infer<typeof migrationStatusSchema>;

export const sourceConfigSchema = z.object({
  publicUrl: z.string().url(),
  cmsLoginUrl: z.string().url().optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  mode: z.enum(["public", "authenticated"]).default("authenticated"),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const wordpressConfigSchema = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1).optional(),
  applicationPassword: z.string().min(1).optional(),
  receiverToken: z.string().min(16).optional(),
  publishMode: z.enum(["draft", "publish"]).default("draft"),
});
export type WordPressConfig = z.infer<typeof wordpressConfigSchema>;

export type EntityKind =
  | "page"
  | "product"
  | "category"
  | "tag"
  | "media"
  | "redirect"
  | "setting"
  | "inquiry";

export interface SourceEntity<T = Record<string, unknown>> {
  sourceId: string;
  kind: EntityKind;
  canonicalUrl?: string;
  title?: string;
  checksum: string;
  data: T;
}

export interface NormalizedMedia {
  sourceId: string;
  sourceUrl: string;
  filename: string;
  mimeType?: string;
  altText: string;
  checksum?: string;
}

export interface NormalizedTerm {
  sourceId: string;
  name: string;
  slug: string;
  description?: string;
}

export interface NormalizedContent {
  sourceId: string;
  kind: "page" | "product";
  title: string;
  slug: string;
  contentHtml: string;
  excerpt: string;
  status: "draft" | "publish";
  sourceUrl: string;
  canonicalUrl: string;
  seo: SeoRecord;
  categories: string[];
  tags: string[];
  featuredMediaSourceId?: string;
  schema?: Record<string, unknown>;
}

export interface SeoRecord {
  primaryKeyword: string;
  title: string;
  description: string;
  h1: string;
  robots: "index,follow" | "noindex,follow";
}

export interface RedirectRecord {
  sourcePath: string;
  targetUrl: string;
  status: 301 | 302;
  reason: string;
}

export interface MigrationBundle {
  version: "1";
  generatedAt: string;
  sourceHost: string;
  pages: NormalizedContent[];
  products: NormalizedContent[];
  categories: NormalizedTerm[];
  tags: NormalizedTerm[];
  media: NormalizedMedia[];
  redirects: RedirectRecord[];
  settings: Record<string, unknown>;
  manifest: ManifestEntry[];
  warnings: string[];
}

export interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface MigrationProgress {
  step: MigrationStep;
  completed: number;
  total: number;
  message: string;
  updatedAt: string;
}

export type MigrationEventKind =
  | "created"
  | "queued"
  | "started"
  | "progress"
  | "paused"
  | "cancelled"
  | "failed"
  | "completed"
  | "updated";

export interface MigrationEvent {
  id: string;
  kind: MigrationEventKind;
  message: string;
  createdAt: string;
  step?: MigrationStep;
  metadata?: Record<string, unknown>;
}

export interface MigrationRecord {
  id: string;
  tenantId: string;
  name: string;
  source: Omit<SourceConfig, "password"> & { encryptedPassword?: string };
  destination?: Omit<WordPressConfig, "applicationPassword" | "receiverToken"> & {
    encryptedApplicationPassword?: string;
    encryptedReceiverToken?: string;
  };
  status: MigrationStatus;
  priority: number;
  runAttempt: number;
  controlRequested?: "pause" | "cancel";
  currentStep?: MigrationStep;
  progress?: MigrationProgress;
  events: MigrationEvent[];
  checkpoints: Partial<Record<MigrationStep, string>>;
  artifactDirectory: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
