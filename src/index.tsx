import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { sameOriginWrites } from "./auth";
import type { AppEnv } from "./env";
import { UploadError } from "./images";
import { renderHtml } from "./render";
import { adminRoutes } from "./routes/admin";
import { apiRoutes } from "./routes/api";
import { notFoundPage, publicRoutes } from "./routes/public";
import { ensureSchema } from "./schema";
import { ValidationError } from "./validate";
import { MessageView, SiteLayout } from "./views/site";

const app = new Hono<AppEnv>({ strict: false });

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // The rich-text editor positions its popups with inline styles.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    // The default (no-referrer) makes browsers send "Origin: null" on form
    // posts, which would defeat the same-origin check on admin writes.
    referrerPolicy: "strict-origin-when-cross-origin",
    // No includeSubDomains: a custom domain's other subdomains aren't ours to force onto HTTPS.
    strictTransportSecurity: "max-age=15552000",
  }),
);
app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});
app.use("*", sameOriginWrites);

app.route("/admin", adminRoutes);
app.route("/api", apiRoutes);
app.route("/", publicRoutes);

app.notFound((c) => notFoundPage(c));

app.onError((err, c) => {
  const isApi = c.req.path.startsWith("/api/");
  if (err instanceof ValidationError || err instanceof UploadError) {
    return isApi ? c.json({ error: err.message }, 400) : c.text(err.message, 400);
  }
  if (err instanceof HTTPException) return err.getResponse();

  console.error(err);
  if (isApi) return c.json({ error: "Something went wrong on the server. Please try again." }, 500);
  return renderHtml(
    c,
    <SiteLayout title="Something went wrong" nav={[]}>
      <MessageView title="Something went wrong" message="Please try again in a moment." />
    </SiteLayout>,
    500,
  );
});

export default app;
