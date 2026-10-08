import Fastify, { LogController } from "fastify";
import type { FastifyServerOptions, FastifyError } from "fastify";
import type { ServerOptions as HttpsOptions } from "node:https";
import type { Pool } from "pg";
import type { TokenVerifier } from "@j-auth/token-verifier";
import { assertCustomerTenantId } from "@j-auth/contracts";
import { WEB_PATHS } from "@j-web/contracts";
import type { SiteView } from "@j-web/contracts";
import { ApiError, unavailable, missing } from "./errors.js";
import { memberGate } from "./auth.js";
const ROUTES = new Set([
  "GET /health/live",
  "GET /health/ready",
  "GET /web/sites",
  "GET /web/sites/:id",
]);
export function createApp(options: {
  pool: Pool;
  tenant: string;
  keycloakOrigin: string;
  verifier?: TokenVerifier;
  fetch?: typeof globalThis.fetch;
  https?: HttpsOptions;
  logger?: FastifyServerOptions["logger"];
}) {
  assertCustomerTenantId(options.tenant);
  const app = Fastify({
    exposeHeadRoutes: false,
    trustProxy: false,
    bodyLimit: 8192,
    ajv: { customOptions: { removeAdditional: false } },
    ...(options.https ? { https: options.https } : {}),
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const member = memberGate(options);
  app.addHook("onRoute", (route) => {
    if (!ROUTES.has(`${route.method} ${route.url}`))
      throw new Error("Route access must be declared.");
    if (route.url.startsWith("/web/"))
      route.onRequest = async (request) => {
        await member(request, "web:read");
      };
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const safe =
      error instanceof ApiError
        ? error
        : "validation" in error ||
            [400, 413, 415].includes(Number(error.statusCode))
          ? new ApiError(
              Number(error.statusCode ?? 400),
              "invalid_input",
              "Invalid request.",
            )
          : unavailable();
    if (safe.status === 503)
      request.log.warn(
        { code: safe.code, requestId: request.id },
        "Web request unavailable",
      );
    reply
      .code(safe.status)
      .send({ code: safe.code, message: safe.message, requestId: request.id });
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await options.pool.query("SELECT checksum FROM schema_migrations LIMIT 1");
    return { status: "ok" };
  });
  app.get<{ Querystring: { limit: number; after?: string } }>(
    WEB_PATHS.sites,
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
            after: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request) => {
      const r = await options.pool.query<SiteView>(
        "SELECT site_id AS id, domain, state FROM sites WHERE tenant_id=$1 AND ($2::uuid IS NULL OR site_id > $2) ORDER BY site_id LIMIT $3",
        [options.tenant, request.query.after ?? null, request.query.limit + 1],
      );
      const items = r.rows.slice(0, request.query.limit);
      return {
        items,
        next: r.rows.length > request.query.limit ? items.at(-1)!.id : null,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    WEB_PATHS.sites + "/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        querystring: { type: "object", additionalProperties: false },
      },
    },
    async (request) => {
      const r = await options.pool.query<SiteView>(
        "SELECT site_id AS id, domain, state FROM sites WHERE tenant_id=$1 AND site_id=$2",
        [options.tenant, request.params.id],
      );
      if (!r.rows[0]) throw missing();
      return r.rows[0];
    },
  );
  return app;
}
