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
import { Hosting } from "./hosting.js";
import type { WebDisk } from "./hosting.js";
import type { HostingHelper } from "./hosting-helper.js";
import { ContentStore } from "./content.js";
import type { ContentWrite, PageContent } from "@j-web/contracts";
const ROUTES = new Set([
  "GET /health/live",
  "GET /health/ready",
  "GET /web/sites",
  "GET /web/sites/:id",
  "GET /web/sites/:id/hosting",
  "GET /web/sites/hosting",
  "GET /web/sites/:id/dns",
  "GET /web/sites/:id/content",
  "PUT /web/sites/:id/content",
  "POST /web/sites/:id/preview",
  "POST /web/sites/:id/deploy",
  "POST /web/sites",
  "POST /web/sites/:id/retry",
  "POST /web/sites/:id/account-password",
  "DELETE /web/sites/:id",
]);
export function createApp(options: {
  pool: Pool;
  tenant: string;
  keycloakOrigin: string;
  verifier?: TokenVerifier;
  fetch?: typeof globalThis.fetch;
  https?: HttpsOptions;
  logger?: FastifyServerOptions["logger"];
  helper?: HostingHelper;
  disk?: WebDisk;
  domainSuffix?: string;
  customerAddress?: string;
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
  const hosting = new Hosting(options);
  const content = new ContentStore(
    options.pool,
    options.tenant,
    options.helper,
  );
  app.addHook("onRoute", (route) => {
    if (!ROUTES.has(`${route.method} ${route.url}`))
      throw new Error("Route access must be declared.");
    if (route.url.startsWith("/web/"))
      route.onRequest = async (request) => {
        await member(
          request,
          route.method === "GET" ? "web:read" : "web:write",
        );
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
    reply.code(safe.status).send({
      code: safe.code,
      message: safe.message,
      requestId: request.id,
      ...(safe.siteId ? { siteId: safe.siteId, phase: safe.phase } : {}),
    });
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await options.pool.query("SELECT checksum FROM schema_migrations LIMIT 1");
    return { status: "ok" };
  });
  const params = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  };
  const password = { type: "string", minLength: 12, maxLength: 256 };
  const emptyQuery = { type: "object", additionalProperties: false };
  const passwordBody = {
    type: "object",
    additionalProperties: false,
    properties: { password },
  };
  const logo = {
    anyOf: [
      { type: "null" },
      {
        type: "object",
        additionalProperties: false,
        required: ["mimeType", "base64"],
        properties: {
          mimeType: { const: "image/png" },
          base64: { type: "string", maxLength: 1398104 },
        },
      },
    ],
  };
  const contentSchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "introduction", "contact", "logo"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      introduction: { type: "string", maxLength: 4096 },
      contact: { type: "string", maxLength: 512 },
      logo,
    },
  };
  app.get<{ Querystring: { limit: number; after?: string } }>(
    WEB_PATHS.hosting,
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            after: { type: "string", format: "uuid" },
          },
        },
      },
    },
    (r) => hosting.listDetails(r.query.limit, r.query.after),
  );
  app.get<{ Params: { id: string } }>(
    WEB_PATHS.sites + "/:id/dns",
    { schema: { params, querystring: emptyQuery } },
    (r) => hosting.dns(r.params.id),
  );
  app.get<{ Params: { id: string } }>(
    WEB_PATHS.sites + "/:id/content",
    { schema: { params, querystring: emptyQuery } },
    (r) => content.read(r.params.id),
  );
  app.put<{ Params: { id: string }; Body: ContentWrite }>(
    WEB_PATHS.sites + "/:id/content",
    {
      bodyLimit: 1500000,
      schema: {
        params,
        querystring: emptyQuery,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedRevision", "content"],
          properties: {
            expectedRevision: {
              type: "integer",
              minimum: 0,
              maximum: 2147483646,
            },
            content: contentSchema,
          },
        },
      },
    },
    (r) => content.save(r.params.id, r.body),
  );
  app.post<{ Params: { id: string }; Body: { content: PageContent } }>(
    WEB_PATHS.sites + "/:id/preview",
    {
      bodyLimit: 1500000,
      schema: {
        params,
        querystring: emptyQuery,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["content"],
          properties: { content: contentSchema },
        },
      },
    },
    (r) => content.preview(r.params.id, r.body.content),
  );
  app.post<{ Params: { id: string }; Body: { expectedRevision: number } }>(
    WEB_PATHS.sites + "/:id/deploy",
    {
      schema: {
        params,
        querystring: emptyQuery,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedRevision"],
          properties: {
            expectedRevision: {
              type: "integer",
              minimum: 1,
              maximum: 2147483647,
            },
          },
        },
      },
    },
    (r) => content.deploy(r.params.id, r.body.expectedRevision),
  );
  app.post<{ Body: { domain: string; password?: string } }>(
    WEB_PATHS.sites,
    {
      schema: {
        querystring: emptyQuery,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["domain"],
          properties: { domain: { type: "string", maxLength: 253 }, password },
        },
      },
    },
    async (request, reply) => {
      const result = await hosting.create(
        request.body.domain,
        request.body.password,
      );
      reply.code(201);
      return result;
    },
  );
  app.get<{ Params: { id: string } }>(
    WEB_PATHS.sites + "/:id/hosting",
    { schema: { params, querystring: emptyQuery } },
    (request) => hosting.details(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: { password?: string } }>(
    WEB_PATHS.sites + "/:id/retry",
    { schema: { params, querystring: emptyQuery, body: passwordBody } },
    (request) => hosting.retry(request.params.id, request.body.password),
  );
  app.post<{ Params: { id: string }; Body: { password?: string } }>(
    WEB_PATHS.sites + "/:id/account-password",
    { schema: { params, querystring: emptyQuery, body: passwordBody } },
    (request) =>
      hosting.resetPassword(request.params.id, request.body.password),
  );
  app.delete<{ Params: { id: string } }>(
    WEB_PATHS.sites + "/:id",
    { schema: { params, querystring: emptyQuery } },
    (request) => hosting.remove(request.params.id),
  );
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
