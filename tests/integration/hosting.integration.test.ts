import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { integrationRuntime } from "./runtime.js";
import type { Runtime } from "./runtime.js";
import { hostingRuntime } from "../hosting/runtime.mjs";
import type { HostingFixture } from "../hosting/runtime.mjs";
import { readFile } from "node:fs/promises";
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
  it("stores validated page revisions in PostgreSQL and previews without changing the uploaded public file", async () => {
    expect(
      await (await call("/" + id + "/content", "GET", undefined, 1)).json(),
    ).toEqual({ siteId: id, revision: 0, content: null });
    const png = await readFile(
      new URL("../fixtures/logo-rgba.png", import.meta.url),
    );
    const content = {
      name: "<script>bad()</script>",
      introduction: "<img src=x onerror=bad()>",
      contact: "&<>",
      logo: { mimeType: "image/png", base64: png.toString("base64") },
    };
    const preview = await call("/" + id + "/preview", "POST", { content });
    expect(preview.status).toBe(200);
    const result = (await preview.json()) as {
      html: string;
      widgetSnippet: string;
    };
    expect(result.html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(result.html).toContain("script-src 'none'");
    expect(result.html).toContain(result.widgetSnippet);
    expect(result.widgetSnippet).toContain(
      "gw." + r.fixtures[0]!.tenant + ".jgw.test/ext/talk/v1/widget.min.js",
    );
    const saves = await Promise.all([
      call("/" + id + "/content", "PUT", { expectedRevision: 0, content }),
      call("/" + id + "/content", "PUT", { expectedRevision: 0, content }),
    ]);
    expect(saves.map((v) => v.status).sort()).toEqual([200, 409]);
    const stored = await call("/" + id + "/content", "GET", undefined, 1);
    expect(await stored.json()).toEqual({ siteId: id, revision: 1, content });
    const restarted = await r.newApp(r.fixtures[0]!.tenant);
    expect(
      await (
        await r.fetch(
          `https://auth.jgw.test:${restarted}/web/sites/${id}/content`,
          { headers: { Authorization: "Bearer " + r.actors[1]!.token } },
        )
      ).json(),
    ).toEqual({ siteId: id, revision: 1, content });
    await h.protocols({
      action: "https",
      domain: "api-hosting.jgw.test",
      data: "api-sftp-byte-proof",
    });
    expect(
      (
        await r.pool.query(
          "SELECT revision,content FROM site_content WHERE tenant_id=$1 AND site_id=$2",
          [r.fixtures[0]!.tenant, id],
        )
      ).rows[0],
    ).toEqual({ revision: 1, content });
  });
  it("deploys only a saved revision atomically, keeps private previous versions, and rejects manual index conflicts", async () => {
    const suffix = randomUUID().slice(0, 8);
    const created = await call("", "POST", {
      domain: `template-${suffix}.jgw.test`,
    });
    expect(created.status).toBe(201);
    const site = (await created.json()) as {
      id: string;
      domain: string;
      account: string;
      password: string;
    };
    r.secrets.add(site.password);
    const content = {
      name: "<script>site</script>",
      introduction: "first page",
      contact: "private contact",
      logo: null,
    };
    expect(
      (
        await call(
          "/" + site.id + "/deploy",
          "POST",
          { expectedRevision: 1 },
          1,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/" + site.id + "/content", "PUT", {
          expectedRevision: 0,
          content,
        })
      ).status,
    ).toBe(200);
    const first = await call("/" + site.id + "/deploy", "POST", {
      expectedRevision: 1,
    });
    expect(first.status).toBe(200);
    const deployed = (await first.json()) as {
      siteId: string;
      revision: number;
      origin: string;
      deployed: boolean;
      previousVersion: string | null;
    };
    expect(deployed).toEqual({
      siteId: site.id,
      revision: 1,
      origin: "https://" + site.domain,
      deployed: true,
      previousVersion: null,
    });
    const retry = await call("/" + site.id + "/deploy", "POST", {
      expectedRevision: 1,
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ...deployed, deployed: false });
    await h.protocols({
      action: "https",
      domain: site.domain,
      target: "/",
      contains: [
        "<!-- j-web-managed-template:v1 revision:1 -->",
        "&lt;script&gt;site&lt;/script&gt;",
        "gw." + r.fixtures[0]!.tenant + ".jgw.test/ext/talk/v1/widget.min.js",
      ],
      notContains: ["private contact"],
    });

    const updated = { ...content, introduction: "second page" };
    expect(
      (
        await call("/" + site.id + "/content", "PUT", {
          expectedRevision: 1,
          content: updated,
        })
      ).status,
    ).toBe(200);
    await h.exec(["mkdir", "-p", "/srv/jweb/backups/deploy"]);
    const unsafeBackupDirectory = `/srv/jweb/backups/deploy/${site.id}`;
    await h.exec(["ln", "-s", "/tmp", unsafeBackupDirectory]);
    const failedReplacement = await call("/" + site.id + "/deploy", "POST", {
      expectedRevision: 2,
    });
    expect(failedReplacement.status).toBe(503);
    expect(await failedReplacement.json()).toMatchObject({
      code: "unsafe_path",
      phase: "deploy",
    });
    await h.protocols({
      action: "https",
      domain: site.domain,
      target: "/",
      contains: ["<!-- j-web-managed-template:v1 revision:1 -->", "first page"],
    });
    await h.exec(["rm", unsafeBackupDirectory]);
    const second = await call("/" + site.id + "/deploy", "POST", {
      expectedRevision: 2,
    });
    expect(second.status).toBe(200);
    const next = (await second.json()) as typeof deployed;
    expect(next).toMatchObject({ revision: 2, deployed: true });
    expect(next.previousVersion).toMatch(/^[a-f0-9-]{36}$/);
    const backup = await h.exec([
      "cat",
      `/srv/jweb/backups/deploy/${site.id}/${next.previousVersion}.html`,
    ]);
    expect(backup.output).toContain(
      "<!-- j-web-managed-template:v1 revision:1 -->",
    );
    await h.protocols({
      action: "https",
      domain: site.domain,
      target: "/",
      contains: [
        "<!-- j-web-managed-template:v1 revision:2 -->",
        "second page",
      ],
    });

    const manualSiteResponse = await call("", "POST", {
      domain: `manual-${suffix}.jgw.test`,
    });
    expect(manualSiteResponse.status).toBe(201);
    const manualSite = (await manualSiteResponse.json()) as {
      id: string;
      domain: string;
      account: string;
      password: string;
    };
    r.secrets.add(manualSite.password);
    const manualBytes = "customer-managed-index-" + suffix;
    await h.protocols({
      action: "sftp-upload",
      account: manualSite.account,
      password: manualSite.password,
      name: "index.html",
      data: manualBytes,
    });
    expect(
      (
        await call("/" + manualSite.id + "/content", "PUT", {
          expectedRevision: 0,
          content,
        })
      ).status,
    ).toBe(200);
    const conflict = await call("/" + manualSite.id + "/deploy", "POST", {
      expectedRevision: 1,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "template_conflict" });
    expect(
      await h.protocols({
        action: "https",
        domain: manualSite.domain,
        data: manualBytes,
      }),
    ).toMatchObject({ ok: true });

    const driftBytes = "manually-edited-managed-index-" + suffix;
    await h.protocols({
      action: "sftp-upload",
      account: site.account,
      password: site.password,
      name: "index.html",
      data: driftBytes,
    });
    const drift = await call("/" + site.id + "/deploy", "POST", {
      expectedRevision: 2,
    });
    expect(drift.status).toBe(409);
    expect(await drift.json()).toMatchObject({ code: "template_conflict" });
    expect(
      await h.protocols({
        action: "https",
        domain: site.domain,
        data: driftBytes,
      }),
    ).toMatchObject({ ok: true });
  });
  it("enforces content authorization, tenant ownership, stale revisions and format errors before changing the stored page", async () => {
    const content = {
      name: "Example",
      introduction: "Intro",
      contact: "Contact",
      logo: null,
    };
    for (const actor of [1, 2])
      for (const operation of ["content", "preview"])
        expect(
          (
            await call(
              "/" + id + "/" + operation,
              operation === "content" ? "PUT" : "POST",
              operation === "content"
                ? { expectedRevision: 1, content }
                : { content },
              actor,
            )
          ).status,
        ).toBe(403);
    for (const operation of ["content", "preview"]) {
      const response = await r.fetch(
        `https://auth.jgw.test:55051/web/sites/${id}/${operation}`,
        {
          method: operation === "content" ? "PUT" : "POST",
          headers: {
            Authorization: "Bearer " + r.foreign,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            operation === "content"
              ? { expectedRevision: 1, content }
              : { content },
          ),
        },
      );
      expect(response.status).toBe(404);
    }
    expect(
      (
        await call("/" + id + "/content", "PUT", {
          expectedRevision: 0,
          content,
        })
      ).status,
    ).toBe(409);
    for (const value of [
      { ...content, path: "/srv/jweb/sites/other" },
      { ...content, name: "가".repeat(41) },
      { ...content, logo: { mimeType: "image/svg+xml", base64: "PHN2Zy8+" } },
      { ...content, logo: { mimeType: "image/png", base64: "AAAA" } },
    ])
      expect(
        (
          await call("/" + id + "/content", "PUT", {
            expectedRevision: 1,
            content: value,
          })
        ).status,
      ).toBe(400);
    expect(
      (await call("/" + id + "/content", "GET", undefined, 2)).status,
    ).toBe(403);
    expect(
      (
        await r.pool.query(
          "SELECT revision FROM site_content WHERE tenant_id=$1 AND site_id=$2",
          [r.fixtures[0]!.tenant, id],
        )
      ).rows[0]?.revision,
    ).toBe(1);
    expect(
      (await call("/" + id + "/deploy", "POST", { expectedRevision: 1 }))
        .status,
    ).toBe(409);
  });
  it("lists actual disk usage and DNS/hosts advice with tenant pagination and no DNS write or secret exposure", async () => {
    const response = await call("/hosting?limit=1", "GET", undefined, 1);
    expect(response.status).toBe(200);
    const list = (await response.json()) as {
      items: {
        id: string;
        usedBytes: string;
        disk: { availableBytes: string };
      }[];
      next: string | null;
    };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.id).toBe(id);
    expect(BigInt(list.items[0]!.usedBytes)).toBeGreaterThan(0n);
    expect(BigInt(list.items[0]!.disk.availableBytes)).toBeGreaterThan(0n);
    expect(
      await (await call("/" + id + "/dns", "GET", undefined, 1)).json(),
    ).toEqual({
      type: "A",
      name: "api-hosting.jgw.test",
      address: "192.0.2.55",
      guidance: "DNS는 등록처·DNS 서비스에서 별도 관리합니다.",
      hostsEntry: "192.0.2.55 api-hosting.jgw.test",
    });
    expect(JSON.stringify(list)).not.toContain(password);
    expect((await call("/hosting?path=/etc", "GET", undefined, 1)).status).toBe(
      400,
    );
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
