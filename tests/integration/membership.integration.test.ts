import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { WEB_PATHS } from "@j-web/contracts";
import { migrate } from "../../apps/server/src/db/migrate.js";
import { probeDataDisk } from "../../apps/server/src/disk.js";
import { integrationRuntime } from "./runtime.js";
import type { Runtime } from "./runtime.js";
describe("actual web database and member boundary", () => {
  it("refuses the cloud host without a separate web data disk and performs no mount/write", async () => {
    await expect(probeDataDisk()).rejects.toThrow();
  });
  let r: Runtime;
  const own = randomUUID(),
    other = randomUUID();
  beforeAll(async () => {
    r = await integrationRuntime();
    for (const [tenant, id, domain] of [
      [r.fixtures[0]!.tenant, own, "own.example.test"],
      [r.fixtures[1]!.tenant, other, "other.example.test"],
    ])
      await r.pool.query(
        "INSERT INTO sites (tenant_id,site_id,domain,state) VALUES ($1,$2,$3,'active')",
        [tenant, id, domain],
      );
  });
  afterAll(async () => {
    await r?.close();
  });
  it("requires its dedicated non-superuser and detects modified migrations", async () => {
    await migrate(r.pool);
    expect(
      (
        await r.pool.query(
          "SELECT current_user, current_database() AS db, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0],
    ).toMatchObject({
      current_user: "jgw_web",
      db: "jgw_web",
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    const otherDb = new Pool({ ...r.pool.options, database: "postgres" });
    try {
      await expect(otherDb.query("SELECT 1")).rejects.toThrow();
    } finally {
      await otherDb.end();
    }
    const checksum = (
      await r.pool.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations LIMIT 1",
      )
    ).rows[0]!.checksum;
    await r.pool.query("UPDATE schema_migrations SET checksum='altered'");
    try {
      await expect(migrate(r.pool)).rejects.toThrow("modified");
    } finally {
      await r.pool.query("UPDATE schema_migrations SET checksum=$1", [
        checksum,
      ]);
    }
    await migrate(r.pool);
    await expect(
      r.pool.query(
        "INSERT INTO sites (tenant_id,site_id,domain,state) VALUES (NULL,$1,'invalid.example.test','active')",
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });
  it("reads actual tenant rows with read/write roles and hides foreign ids as 404", async () => {
    for (const actor of r.actors.slice(0, 2)) {
      expect(
        await (await r.request(WEB_PATHS.sites, actor.token)).json(),
      ).toEqual({
        items: [{ id: own, domain: "own.example.test", state: "active" }],
        next: null,
      });
      expect(
        (await r.request(WEB_PATHS.sites + "/" + other, actor.token)).status,
      ).toBe(404);
    }
    expect(
      (await r.request(WEB_PATHS.sites + "/" + own, r.actors[1]!.token)).status,
    ).toBe(200);
    expect(
      await (await r.request(WEB_PATHS.sites, r.foreign, 55051)).json(),
    ).toEqual({
      items: [{ id: other, domain: "other.example.test", state: "active" }],
      next: null,
    });
    expect((await r.request(WEB_PATHS.sites, r.actors[2]!.token)).status).toBe(
      403,
    );
  });
  it("rejects bad signature, foreign tenant, unreduced audience and browser cookie", async () => {
    for (const token of [
      "invalid",
      r.foreign,
      r.actors[0]!.original,
      r.actors[0]!.token.slice(0, -10) + "AAAAAAAAAA",
    ])
      expect((await r.request(WEB_PATHS.sites, token)).status).toBe(401);
    expect(
      (
        await r.request(WEB_PATHS.sites, r.actors[0]!.token, 55047, {
          Cookie: "native=1",
        })
      ).status,
    ).toBe(401);
    expect(
      (await r.fetch("https://auth.jgw.test:55047" + WEB_PATHS.sites)).status,
    ).toBe(401);
  });
  it("rejects source/tenant injection, invalid ids and keeps write lifecycle absent", async () => {
    for (const path of [
      WEB_PATHS.sites + "?tenant=other",
      WEB_PATHS.sites + "?limit=101",
      WEB_PATHS.sites + "/invalid",
      WEB_PATHS.sites + "/" + own + "?tenant=other",
    ])
      expect((await r.request(path, r.actors[0]!.token)).status).toBe(400);
    expect(
      (
        await r.fetch("https://auth.jgw.test:55047" + WEB_PATHS.sites, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + r.actors[0]!.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ domain: "never-created.example.test" }),
        })
      ).status,
    ).toBe(404);
  });
  it("returns 503 for actual unreachable fresh JWKS", async () => {
    const broken: typeof fetch = (input, init) =>
      r.fetch(
        String(input).replace("auth.jgw.test:58443", "127.0.0.1:59997"),
        init,
      );
    const port = await r.newApp(r.fixtures[0]!.tenant, 0, { fetch: broken });
    expect(
      (await r.request(WEB_PATHS.sites, r.actors[0]!.token, port)).status,
    ).toBe(503);
  });
  it("fails closed on actual dedicated DB stop and recovers persisted rows", async () => {
    execFileSync("docker", ["stop", "suite-ready-web-pg-20261008"], {
      stdio: "ignore",
    });
    try {
      expect(
        (await r.request(WEB_PATHS.sites, r.actors[0]!.token)).status,
      ).toBe(503);
    } finally {
      execFileSync("docker", ["start", "suite-ready-web-pg-20261008"], {
        stdio: "ignore",
      });
    }
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await r.pool.query("SELECT 1");
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(ready).toBe(true);
    expect(
      (await r.request(WEB_PATHS.sites + "/" + own, r.actors[0]!.token)).status,
    ).toBe(200);
  });
});
