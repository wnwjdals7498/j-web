import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { integrationRuntime } from "./runtime.js";
import type { Runtime } from "./runtime.js";
import { hostingRuntime } from "../hosting/runtime.mjs";
import type { HostingFixture } from "../hosting/runtime.mjs";
describe("actual web write lifecycle with PostgreSQL, exchanged members and root hosting daemons", () => {
  let r: Runtime,
    h: HostingFixture,
    port: number,
    id: string,
    account: string,
    partialId: string;
  const password = randomBytes(24).toString("base64url"),
    replacement = randomBytes(24).toString("base64url");
  const call = (path: string, method = "GET", body?: unknown, actor = 0) =>
    r.fetch(`https://auth.jgw.test:${port}/web/sites${path}`, {
      method,
      headers: {
        Authorization: "Bearer " + r.actors[actor]!.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  beforeAll(async () => {
    r = await integrationRuntime();
    h = await hostingRuntime(r.fixtures[0]!.tenant);
    port = await r.newApp(r.fixtures[0]!.tenant, 0, {
      helper: { run: h.helper },
      disk: h.disk,
      customerAddress: "192.0.2.55",
    });
    r.secrets.add(password);
    r.secrets.add(replacement);
  });
  afterAll(async () => {
    try {
      await h?.close();
    } finally {
      await r?.close();
    }
  });
  it("rejects read/no-role writes, foreign ids, account/path injection and an actual missing host disk before creating rows", async () => {
    for (const actor of [1, 2])
      for (const [method, path, body] of [
        ["POST", "", { domain: "denied.jgw.test" }],
        ["DELETE", "/" + randomUUID(), undefined],
        ["POST", "/" + randomUUID() + "/account-password", {}],
      ] as const)
        expect((await call(path, method, body, actor)).status).toBe(403);
    for (const body of [
      { domain: "x.jgw.test", path: "/etc" },
      { domain: "x;root /;.jgw.test" },
      { domain: "auth.jgw.test" },
      { domain: "foreign.example.test" },
      { domain: "x.jgw.test", password: "danger\nroot:replacement" },
    ])
      expect((await call("", "POST", body)).status).toBe(400);
    expect((await call("/" + randomUUID(), "DELETE")).status).toBe(404);
    const missing = await r.fetch("https://auth.jgw.test:55047/web/sites", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + r.actors[0]!.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ domain: "diskless.jgw.test" }),
    });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ code: "data_disk_required" });
    expect(
      (
        await r.pool.query(
          "SELECT 1 FROM sites WHERE domain IN ('denied.jgw.test','diskless.jgw.test')",
        )
      ).rowCount,
    ).toBe(0);
  });
  it("creates real chroot/account/TLS hosting; reads usage and DNS advice without retaining passwords", async () => {
    const response = await call("", "POST", {
      domain: "api-hosting.jgw.test",
      password,
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      id: string;
      account: string;
      password: string;
    };
    id = created.id;
    account = created.account;
    expect(created.password).toBe(password);
    await h.protocols({
      action: "sftp-upload",
      account,
      password,
      name: "index.html",
      data: "api-sftp-byte-proof",
    });
    await h.protocols({
      action: "https",
      domain: "api-hosting.jgw.test",
      data: "api-sftp-byte-proof",
    });
    const details = await call("/" + id + "/hosting", "GET", undefined, 1);
    expect(details.status).toBe(200);
    const view = (await details.json()) as {
      usedBytes: string;
      disk: { totalBytes: string; availableBytes: string };
      dns: unknown;
    };
    expect(BigInt(view.usedBytes)).toBeGreaterThan(0n);
    expect(BigInt(view.disk.totalBytes)).toBeGreaterThan(0n);
    expect(view.dns).toEqual({
      type: "A",
      name: "api-hosting.jgw.test",
      address: "192.0.2.55",
    });
    expect(JSON.stringify(view)).not.toContain(password);
    expect(
      (await call("", "POST", { domain: "api-hosting.jgw.test" })).status,
    ).toBe(409);
    const rows = await r.pool.query(
      "SELECT row_to_json(sites)::text AS value FROM sites WHERE tenant_id=$1",
      [r.fixtures[0]!.tenant],
    );
    for (const row of rows.rows) expect(row.value).not.toContain(password);
  });
  it("preserves actual failed nginx stage and retries the same id without creating another account or site", async () => {
    await h.exec([
      "node",
      "-e",
      "require('fs').writeFileSync('/etc/nginx/conf.d/fixture-failure.conf','invalid_directive;')",
    ]);
    try {
      const failed = await call("", "POST", {
        domain: "partial-hosting.jgw.test",
        password,
      });
      expect(failed.status).toBe(503);
      const error = (await failed.json()) as { siteId: string };
      partialId = error.siteId;
      expect(error).toMatchObject({
        code: "nginx_validation_failed",
        phase: "nginx_apply",
      });
      expect(
        (
          await r.pool.query(
            "SELECT state,operation_phase,last_error FROM sites WHERE tenant_id=$1 AND site_id=$2",
            [r.fixtures[0]!.tenant, partialId],
          )
        ).rows[0],
      ).toEqual({
        state: "failed",
        operation_phase: "nginx_apply",
        last_error: "nginx_validation_failed",
      });
      await h.protocols({
        action: "https",
        domain: "api-hosting.jgw.test",
        data: "api-sftp-byte-proof",
      });
    } finally {
      await h.exec(["rm", "/etc/nginx/conf.d/fixture-failure.conf"]);
    }
    const retry = await call("/" + partialId + "/retry", "POST", {
      password: replacement,
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      id: partialId,
      state: "active",
      password: replacement,
    });
    expect(
      (
        await r.pool.query(
          "SELECT 1 FROM sites WHERE domain='partial-hosting.jgw.test'",
        )
      ).rowCount,
    ).toBe(1);
  });
  it("resets an actual account, removes it and preserves content in a backup without exposing secrets", async () => {
    const reset = await call("/" + id + "/account-password", "POST", {
      password: replacement,
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({
      id,
      account,
      password: replacement,
    });
    await h.protocols({ action: "ftps-deny", account, password });
    await h.protocols({
      action: "ftps-upload",
      account,
      password: replacement,
      name: "retained.txt",
      data: "api-backup-bytes",
    });
    const deleted = await call("/" + id, "DELETE");
    expect(deleted.status).toBe(200);
    const result = (await deleted.json()) as { backupId: string };
    expect(
      (
        await h.exec([
          "cat",
          "/srv/jweb/backups/" + result.backupId + "/site/public/retained.txt",
        ])
      ).output,
    ).toBe("api-backup-bytes");
    expect((await call("/" + id)).status).toBe(404);
    await h.protocols({ action: "ftps-deny", account, password: replacement });
    expect((await call("/" + partialId, "DELETE")).status).toBe(200);
    for (const secret of r.secrets)
      expect(r.logs.join("\n")).not.toContain(secret);
  });
});
