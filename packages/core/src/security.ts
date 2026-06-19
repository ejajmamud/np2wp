import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "v1";

function encryptionKey(base64Key: string): Buffer {
  const decoded = Buffer.from(base64Key, "base64");
  if (decoded.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return decoded;
}

export function encryptSecret(plaintext: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(base64Key), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, base64Key: string): string {
  const [version, iv, tag, encrypted] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error("Invalid encrypted credential payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(base64Key),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeTokenEquals(a: string, b: string): boolean {
  const left = Buffer.from(sha256(a));
  const right = Buffer.from(sha256(b));
  return timingSafeEqual(left, right);
}

export function redactSecrets<T>(value: T): T {
  const secretKeys = /password|token|secret|authorization|cookie/i;
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [
          key,
          secretKeys.test(key) ? "[REDACTED]" : visit(item),
        ]),
      );
    }
    return input;
  };
  return visit(value) as T;
}
