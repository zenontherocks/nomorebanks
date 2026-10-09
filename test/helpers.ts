import { exports } from "cloudflare:workers";

export const ORIGIN = "https://example.com";
export const PASSWORD = "test-password";

/** A 1×1 transparent PNG. */
export const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (ch) => ch.charCodeAt(0),
);

let ipCounter = 0;

/** A distinct client IP per call so login throttling in one test can't affect another. */
export function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

export function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }));
}

export function postLogin(password: string, ip = freshIp()): Promise<Response> {
  return fetchWorker("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip, origin: ORIGIN },
    body: new URLSearchParams({ password }),
  });
}

/** Logs in and returns the Cookie header value for the session. */
export async function login(): Promise<string> {
  const res = await postLogin(PASSWORD);
  if (res.status !== 303) throw new Error(`login failed with ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}

export function api(cookie: string, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("cookie", cookie);
  headers.set("x-requested-with", "nmb-admin");
  headers.set("origin", ORIGIN);
  if (json !== undefined) headers.set("content-type", "application/json");
  return fetchWorker(`/api${path}`, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
}

export function textDelta(text: string) {
  return { ops: [{ insert: `${text}\n` }] };
}
