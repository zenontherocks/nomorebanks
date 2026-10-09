import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./env";

export const SESSION_COOKIE = "nmb_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCKOUT_SECONDS = 15 * 60;

const encoder = new TextEncoder();

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison (hashing first makes both inputs the same length). */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

/** Returns the unix time the IP is locked out until, or 0 if it isn't. */
export async function lockedOutUntil(db: D1Database, ip: string): Promise<number> {
  const row = await db
    .prepare("SELECT locked_until FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first<{ locked_until: number }>();
  return row && row.locked_until > nowSeconds() ? row.locked_until : 0;
}

/** Counts a failed login; MAX_FAILURES within the window locks the IP out. */
export async function recordFailedLogin(db: D1Database, ip: string): Promise<void> {
  const now = nowSeconds();
  await db.batch([
    db
      .prepare(
        `INSERT INTO login_attempts (ip, failures, locked_until, updated_at) VALUES (?1, 1, 0, ?2)
         ON CONFLICT (ip) DO UPDATE SET
           failures = CASE WHEN updated_at < ?2 - ?3 THEN 1 ELSE failures + 1 END,
           updated_at = ?2`,
      )
      .bind(ip, now, LOCKOUT_SECONDS),
    db
      .prepare("UPDATE login_attempts SET failures = 0, locked_until = ?2 + ?3 WHERE ip = ?1 AND failures >= ?4")
      .bind(ip, now, LOCKOUT_SECONDS, MAX_FAILURES),
  ]);
}

export async function clearFailedLogins(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

export async function createSession(c: Context<AppEnv>): Promise<void> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const now = nowSeconds();
  // Only a hash of the token is stored, so a database leak can't be replayed as a login.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    c.env.DB.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").bind(
      await sha256Hex(token),
      now + SESSION_TTL_SECONDS,
    ),
  ]);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function hasValidSession(c: Context<AppEnv>): Promise<boolean> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  const row = await c.env.DB.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256Hex(token), nowSeconds())
    .first();
  return row !== null;
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * Rejects cross-site form posts: browsers always send Origin on POST/PUT/DELETE,
 * and it must match this site.
 */
export const sameOriginWrites: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.text("Forbidden", 403);
  }
  await next();
};

/** Guards the JSON API: a valid session plus the admin console's custom header. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  // A custom header can't be added by a plain cross-site form or link.
  if (c.req.header("x-requested-with") !== "nmb-admin") {
    return c.json({ error: "Missing admin request header." }, 400);
  }
  if (!(await hasValidSession(c))) {
    return c.json({ error: "Your session has expired. Please log in again." }, 401);
  }
  await next();
};
