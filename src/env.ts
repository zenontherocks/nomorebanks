export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** Set as a secret in the Cloudflare dashboard, or in .dev.vars locally. */
  ADMIN_PASSWORD?: string;
}

export type AppEnv = { Bindings: Env };
