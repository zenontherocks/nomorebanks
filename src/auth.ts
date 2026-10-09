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

/**
 * The key login attempts are counted under. IPv6 clients usually control a
 * whole block of addresses, so they're grouped by /56 prefix; otherwise an
 * attacker could switch address every few guesses.
 */
export function throttleKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.split("%")[0].toLowerCase().split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0");
  const hex = [...headGroups, ...zeros, ...tailGroups]
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join("");
  return `${hex.slice(0, 14)}::/56`;
}

/**
 * Counts a login attempt *before* the password is checked, and reports whether
 * the client may try. Doing the check and the count in one statement means a
 * burst of simultaneous guesses can't all slip in before the lockout applies.
 * After MAX_FAILURES attempts the key is locked for LOCKOUT_SECONDS, measured
 * from its most recent attempt.
 */
export async function reserveLoginAttempt(db: D1Database, key: string): Promise<boolean> {
  const now = nowSeconds();
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (ip, failures, locked_until, updated_at) VALUES (?1, 1, 0, ?2)
       ON CONFLICT (ip) DO UPDATE SET
         failures = CASE
           WHEN locked_until > ?2 THEN failures
           WHEN updated_at < ?2 - ?3 THEN 1
           ELSE failures + 1
         END,
         locked_until = CASE
           WHEN locked_until > ?2 THEN locked_until
           WHEN (CASE WHEN updated_at < ?2 - ?3 THEN 1 ELSE failures + 1 END) > ?4 THEN ?2 + ?3
           ELSE 0
         END,
         updated_at = ?2
       RETURNING locked_until`,
    )
    .bind(key, now, LOCKOUT_SECONDS, MAX_FAILURES)
    .first<{ locked_until: number }>();
  return !row || row.locked_until <= now;
}

export async function clearLoginAttempts(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(key).run();
}

/**
 * Sessions are stored as a hash of the token *and* the current password, so
 * changing ADMIN_PASSWORD logs out every existing session. Only hashes are
 * stored, so a database leak can't be replayed as a login.
 */
function sessionHash(token: string, password: string): Promise<string> {
  return sha256Hex(`${token}\0${password}`);
}

export async function createSession(c: Context<AppEnv>): Promise<void> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const now = nowSeconds();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    c.env.DB.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").bind(
      await sessionHash(token, c.env.ADMIN_PASSWORD ?? ""),
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
  const password = c.env.ADMIN_PASSWORD;
  if (!token || !password) return false;
  const row = await c.env.DB.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sessionHash(token, password), nowSeconds())
    .first();
  return row !== null;
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sessionHash(token, c.env.ADMIN_PASSWORD ?? ""))
      .run();
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
