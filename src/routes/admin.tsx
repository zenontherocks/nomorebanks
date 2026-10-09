import { Hono } from "hono";
import {
  clearLoginAttempts,
  clientIp,
  createSession,
  destroySession,
  hasValidSession,
  passwordMatches,
  reserveLoginAttempt,
  throttleKey,
} from "../auth";
import type { AppEnv } from "../env";
import { renderHtml } from "../render";
import { AdminAppView, LoginView } from "../views/admin";

// The admin console isn't linked from the public site. It is protected by the
// ADMIN_PASSWORD secret, not by its address being hard to guess.
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  c.res.headers.set("Cache-Control", "no-store");
});

adminRoutes.get("/", async (c) => {
  if (await hasValidSession(c)) return renderHtml(c, <AdminAppView />);
  return renderHtml(c, <LoginView configured={Boolean(c.env.ADMIN_PASSWORD)} />);
});

adminRoutes.post("/login", async (c) => {
  const expected = c.env.ADMIN_PASSWORD;
  if (!expected) return renderHtml(c, <LoginView configured={false} />, 503);

  const key = throttleKey(clientIp(c));
  if (!(await reserveLoginAttempt(c.env.DB, key))) {
    return renderHtml(
      c,
      <LoginView configured error="Too many failed attempts. Please wait 15 minutes and try again." />,
      429,
    );
  }

  const form = await c.req.parseBody();
  const password = typeof form.password === "string" ? form.password : "";
  if (!(await passwordMatches(password, expected))) {
    return renderHtml(c, <LoginView configured error="Incorrect password." />, 401);
  }

  await clearLoginAttempts(c.env.DB, key);
  await createSession(c);
  return c.redirect("/admin", 303);
});

adminRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.redirect("/admin", 303);
});
