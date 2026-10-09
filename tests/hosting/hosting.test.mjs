import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  // A stale fixture image must not silently ignore the body assertions.
  await assert.rejects(
    fixture.protocols({
      action: "https",
      domain: "hosting-a.jgw.test",
      contains: ["absent-marker-" + randomUUID()],
    }),
    /Actual protocol https failed/,
  );
  await assert.rejects(
    fixture.protocols({
      action: "https",
      domain: "hosting-a.jgw.test",
      notContains: [data],
    }),
    /Actual protocol https failed/,
  );
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
test("deployment journal retries reuse one backup id and recover before and after atomic replacement", async () => {
  const id = randomUUID();
  const deploymentAccount = "jw-" + randomBytes(6).toString("hex");
  const deploymentPassword = randomBytes(24).toString("base64url");
  const origin = `journal-${id.slice(0, 8)}.jgw.test`;
  const html = (revision, text) =>
    `<!doctype html>\n<!-- j-web-managed-template:v1 revision:${revision} -->\n<html><body>${text}</body></html>\n`;
  const firstPage = html(1, "first managed page"),
    secondPage = html(2, "second managed page"),
    thirdPage = html(3, "third managed page"),
    digest = (value) => createHash("sha256").update(value).digest("hex");
  const journalPath = `/var/lib/jweb/${id}.deploy.json`;
  const backupDirectory = `/srv/jweb/backups/deploy/${id}`;
  const putRootFile = async (file, content) =>
    fixture.exec([
      "node",
      "-e",
      "require('node:fs').writeFileSync(process.argv[1],process.argv[2],{mode:0o600})",
      file,
      content,
    ]);
  const replaceAtomicallyAsHelper = async (file, content) =>
    fixture.exec([
      "node",
      "-e",
      "const fs=require('node:fs');const{execFileSync}=require('node:child_process');const p=execFileSync('/usr/bin/getent',['passwd',process.argv[3]],{encoding:'utf8'}).trim().split(':');const g=execFileSync('/usr/bin/getent',['group','jweb-sftp'],{encoding:'utf8'}).trim().split(':');const t=process.argv[1]+'.crash-fixture';fs.writeFileSync(t,process.argv[2],{flag:'wx',mode:0o644});fs.chownSync(t,Number(p[2]),Number(g[2]));fs.chmodSync(t,0o644);fs.renameSync(t,process.argv[1]);",
      file,
      content,
      deploymentAccount,
    ]);
  const writeJournal = async (record) =>
    putRootFile(journalPath, JSON.stringify(record) + "\n");

  assert.equal(
    (
      await fixture.helper("site-create", {
        siteId: id,
        domain: origin,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await fixture.helper("account-create", {
        siteId: id,
        account: deploymentAccount,
        password: deploymentPassword,
      })
    ).ok,
    true,
  );
  assert.equal((await fixture.helper("nginx-apply", { siteId: id })).ok, true);

  const first = await fixture.helper("content-deploy", {
    siteId: id,
    revision: 1,
    html: firstPage,
  });
  assert.equal(first.ok, true);
  const beforeBackupId = randomUUID();
  await writeJournal({
    siteId: id,
    revision: 2,
    previousHash: digest(firstPage),
    previousVersion: beforeBackupId,
    sha256: digest(secondPage),
  });
  const beforeBackupRecovery = await fixture.helper("content-deploy", {
    siteId: id,
    revision: 2,
    html: secondPage,
  });
  assert.equal(beforeBackupRecovery.ok, true);
  assert.equal(beforeBackupRecovery.previousVersion, beforeBackupId);
  assert.equal(
    (await fixture.exec(["cat", `${backupDirectory}/${beforeBackupId}.html`]))
      .output,
    firstPage,
  );
  const repeated = await fixture.helper("content-deploy", {
    siteId: id,
    revision: 2,
    html: secondPage,
  });
  assert.equal(repeated.deployed, false);
  assert.equal(repeated.previousVersion, beforeBackupId);

  const afterReplaceBackupId = randomUUID();
  await fixture.exec(["mkdir", "-p", backupDirectory]);
  await putRootFile(
    `${backupDirectory}/${afterReplaceBackupId}.html`,
    secondPage,
  );
  await writeJournal({
    siteId: id,
    revision: 3,
    previousHash: digest(secondPage),
    previousVersion: afterReplaceBackupId,
    sha256: digest(thirdPage),
  });
  // Reproduce the state after the helper's atomic rename and before its
  // journal-to-state finalization, then let a retry complete recovery.
  await replaceAtomicallyAsHelper(
    `/srv/jweb/sites/${id}/public/index.html`,
    thirdPage,
  );
  const afterReplacementRecovery = await fixture.helper("content-deploy", {
    siteId: id,
    revision: 3,
    html: thirdPage,
  });
  assert.equal(afterReplacementRecovery.ok, true);
  assert.equal(afterReplacementRecovery.deployed, false);
  assert.equal(afterReplacementRecovery.previousVersion, afterReplaceBackupId);
  assert.equal(
    (
      await fixture.exec([
        "cat",
        `${backupDirectory}/${afterReplaceBackupId}.html`,
      ])
    ).output,
    secondPage,
  );
  await fixture.protocols({
    action: "https",
    domain: origin,
    target: "/",
    contains: [thirdPage],
  });

  await writeJournal({
    siteId: id,
    revision: 4,
    previousHash: null,
    previousVersion: randomUUID(),
    sha256: digest(html(4, "invalid journal")),
  });
  const invalidJournal = await fixture.helper("content-deploy", {
    siteId: id,
    revision: 4,
    html: html(4, "invalid journal"),
  });
  assert.equal(invalidJournal.code, "invalid_state");
});
