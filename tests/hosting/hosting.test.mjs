import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hostingRuntime } from "./runtime.mjs";
let fixture;
const siteId = randomUUID(),
  otherId = randomUUID(),
  account = "jw-" + randomBytes(6).toString("hex"),
  otherAccount = "jw-" + randomBytes(6).toString("hex");
const password = randomBytes(24).toString("base64url"),
  replacement = randomBytes(24).toString("base64url");
before(async () => {
  fixture = await hostingRuntime("web-hosting");
});
after(async () => {
  await fixture?.close();
});
test("separate data mount and all fixed helper commands use real root-owned paths and sudo restrictions", async () => {
  assert.equal((await fixture.disk.probe()).root, "/srv/jweb");
  const forbidden = await fixture.exec(
    ["sudo", "-n", "--", "/usr/bin/id"],
    "",
    true,
    "jweb",
  );
  assert.notEqual(forbidden.code, 0);
  assert.equal(
    (
      await fixture.helper("site-create", {
        siteId,
        domain: "hosting-a.jgw.test",
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await fixture.helper("site-create", {
        siteId,
        domain: "hosting-a.jgw.test",
      })
    ).ok,
    true,
  );
  assert.equal(
    (await fixture.helper("account-create", { siteId, account, password })).ok,
    true,
  );
  assert.equal((await fixture.helper("nginx-apply", { siteId })).ok, true);
  assert.equal(
    (
      await fixture.helper("site-create", {
        siteId: otherId,
        domain: "hosting-b.jgw.test",
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await fixture.helper("account-create", {
        siteId: otherId,
        account: otherAccount,
        password,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await fixture.helper("nginx-apply", { siteId: otherId })).ok,
    true,
  );
  const value = await fixture.helper("site-create", {
    siteId: randomUUID(),
    domain: "auth.jgw.test",
  });
  assert.equal(value.code, "domain_not_allowed");
  assert.equal((await fixture.helper("anything", {})).code, "invalid_request");
  await fixture.exec(["mkdir", "/run/jweb-helper.lock"]);
  try {
    assert.equal(
      (
        await fixture.helper("site-create", {
          siteId: randomUUID(),
          domain: "busy.jgw.test",
        })
      ).code,
      "busy",
    );
  } finally {
    await fixture.exec(["rmdir", "/run/jweb-helper.lock"]);
  }
  await fixture.exec([
    "node",
    "-e",
    "require('fs').writeFileSync('/tmp/jweb-malicious.mjs',\"require('fs').writeFileSync('/run/jweb-env-injected','bad')\")",
  ]);
  const clean = await fixture.exec(
    [
      "env",
      "NODE_OPTIONS=--import=/tmp/jweb-malicious.mjs",
      "sudo",
      "-n",
      "--",
      "/usr/local/sbin/jweb-helper",
      "site-create",
    ],
    JSON.stringify({ siteId, domain: "hosting-a.jgw.test" }),
    false,
    "jweb",
  );
  assert.equal(JSON.parse(clean.output).ok, true);
  assert.notEqual(
    (await fixture.exec(["test", "-e", "/run/jweb-env-injected"], "", true))
      .code,
    0,
  );
});
test("actual SFTP and explicit TLS FTPS uploads are served by site HTTPS; plain FTP, shell, forwarding and other-site paths fail", async () => {
  await fixture.protocols({
    action: "ftps-upload",
    account: otherAccount,
    password,
    name: "index.html",
    data: "other-site-private-byte-proof",
  });
  await fixture.protocols({
    action: "https",
    domain: "hosting-b.jgw.test",
    data: "other-site-private-byte-proof",
  });
  const data = "actual-sftp-" + randomUUID();
  await fixture.protocols({
    action: "sftp-upload",
    account,
    password,
    name: "index.html",
    data,
  });
  await fixture.protocols({
    action: "https",
    domain: "hosting-a.jgw.test",
    data,
  });
  await fixture.protocols({
    action: "ftps-upload",
    account,
    password,
    name: "ftps.txt",
    data: "actual-ftps-bytes",
  });
  await fixture.protocols({
    action: "https",
    domain: "hosting-a.jgw.test",
    target: "/ftps.txt",
    data: "actual-ftps-bytes",
  });
  await fixture.protocols({ action: "plain-ftp-deny", account, password });
  await fixture.protocols({
    action: "sftp-deny",
    account,
    password,
    target: "/etc/passwd",
  });
  await fixture.protocols({
    action: "sftp-deny",
    account,
    password,
    target: "/srv/jweb/sites/" + otherId + "/public/index.html",
  });
  await fixture.protocols({ action: "ssh-deny", account, password });
  await fixture.protocols({
    action: "ssh-deny",
    account,
    password,
    forward: true,
  });
  assert(BigInt(await fixture.disk.usage(siteId)) > 0n);
  await fixture.exec([
    "ln",
    "-s",
    "/srv/jweb/sites/" + otherId + "/public",
    "/srv/jweb/sites/" + siteId + "/public/escape",
  ]);
  await fixture.protocols({
    action: "https",
    domain: "hosting-a.jgw.test",
    target: "/escape/index.html",
    status: 404,
  });
});
test("nginx validation and reload failure restore prior site config and preserve the unrelated gateway", async () => {
  const file = "/etc/nginx/jweb.d/" + siteId + ".conf",
    previous = (await fixture.exec(["cat", file])).output;
  await fixture.exec([
    "node",
    "-e",
    "require('fs').writeFileSync('/etc/nginx/conf.d/fixture-broken.conf','invalid_directive;')",
  ]);
  try {
    const result = await fixture.helper("site-delete", { siteId });
    assert.equal(result.code, "nginx_validation_failed");
    assert.equal(result.restored, true);
    assert.equal((await fixture.exec(["cat", file])).output, previous);
  } finally {
    await fixture.exec(["rm", "/etc/nginx/conf.d/fixture-broken.conf"]);
  }
  await fixture.protocols({
    action: "https",
    domain: "fixture.jgw.test",
    target: "/",
    data: "gateway-preserved",
  });
  await fixture.exec(["mv", "/run/nginx.pid", "/run/nginx.fixture-pid"]);
  try {
    const result = await fixture.helper("nginx-apply", { siteId });
    assert.equal(result.code, "nginx_reload_failed");
    assert.equal(result.restored, true);
    assert.equal(result.rollbackReload, false);
    assert.equal((await fixture.exec(["cat", file])).output, previous);
  } finally {
    await fixture.exec(["mv", "/run/nginx.fixture-pid", "/run/nginx.pid"]);
  }
});
test("password reset rejects the previous password; deletion and remove-all preserve uploaded bytes in private backups", async () => {
  assert.equal(
    (
      await fixture.helper("account-passwd", {
        siteId,
        account,
        password: replacement,
      })
    ).ok,
    true,
  );
  await fixture.protocols({ action: "ftps-deny", account, password });
  await fixture.protocols({
    action: "ftps-upload",
    account,
    password: replacement,
    name: "retained.txt",
    data: "backup-proof",
  });
  const state = (
    await fixture.exec(["cat", "/var/lib/jweb/" + siteId + ".json"])
  ).output;
  assert(!state.includes(password));
  assert(!state.includes(replacement));
  const result = await fixture.helper("site-delete", { siteId });
  assert.equal(result.ok, true);
  assert.equal(result.phase, "deleted");
  assert.equal(
    (
      await fixture.exec([
        "cat",
        "/srv/jweb/backups/" + result.backupId + "/site/public/retained.txt",
      ])
    ).output,
    "backup-proof",
  );
  await fixture.protocols({
    action: "ftps-deny",
    account,
    password: replacement,
  });
  assert.equal(
    (await fixture.helper("site-delete", { siteId })).backupId,
    result.backupId,
  );
  const all = await fixture.helper("remove-all", {});
  assert.equal(all.ok, true);
  assert.equal(all.removed, 1);
  await fixture.protocols({
    action: "ftps-deny",
    account: otherAccount,
    password,
  });
  await fixture.protocols({
    action: "https",
    domain: "fixture.jgw.test",
    target: "/",
    data: "gateway-preserved",
  });
  assert.equal((await fixture.helper("remove-all", {})).removed, 0);
});
