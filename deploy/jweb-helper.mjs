#!/usr/bin/node
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  chown,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
const ROOT = "/srv/jweb",
  STATE = "/var/lib/jweb",
  BLOCKS = "/etc/nginx/jweb.d",
  TLS = "/etc/jweb/tls",
  LOCK = "/run/jweb-helper.lock";
const ENV = { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" };
const SHAPES = {
  "site-create": ["siteId", "domain"],
  "site-delete": ["siteId"],
  "account-create": ["siteId", "account", "password"],
  "account-passwd": ["siteId", "account", "password"],
  "account-delete": ["siteId", "account"],
  "nginx-apply": ["siteId"],
  "remove-all": [],
  "retained-state": [],
};
export class HelperError extends Error {
  constructor(code, phase = "validation", details = {}) {
    super(code);
    this.code = code;
    this.phase = phase;
    this.details = details;
  }
}
export function validateRequest(command, body) {
  const shape = SHAPES[command];
  if (
    !shape ||
    !body ||
    Array.isArray(body) ||
    typeof body !== "object" ||
    Object.keys(body).length !== shape.length ||
    shape.some((k) => body[k] === undefined) ||
    Object.keys(body).some((k) => !shape.includes(k))
  )
    throw new HelperError("invalid_request");
  if (
    body.siteId !== undefined &&
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(body.siteId)
  )
    throw new HelperError("invalid_site");
  if (
    body.domain !== undefined &&
    (typeof body.domain !== "string" ||
      body.domain.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(body.domain) ||
      body.domain
        .split(".")
        .some(
          (s) => !s || s.length > 63 || s.startsWith("-") || s.endsWith("-"),
        ))
  )
    throw new HelperError("invalid_domain");
  if (
    body.account !== undefined &&
    (typeof body.account !== "string" ||
      !/^jw-[a-z0-9]{4,24}$/.test(body.account))
  )
    throw new HelperError("invalid_account");
  if (
    body.password !== undefined &&
    (typeof body.password !== "string" ||
      body.password.length < 12 ||
      Buffer.byteLength(body.password) > 256 ||
      /[\x00-\x1f\x7f:]/u.test(body.password))
  )
    throw new HelperError("invalid_password");
  return body;
}
async function trusted(target, directory = false) {
  const s = await lstat(target);
  if (
    s.isSymbolicLink() ||
    (directory ? !s.isDirectory() : !s.isFile()) ||
    s.uid !== 0 ||
    s.mode & 0o022
  )
    throw new HelperError("unsafe_path", "filesystem");
  return s;
}
async function rootDirectory(target, create = false) {
  const parts = [];
  for (let current = target; current !== "/"; current = path.dirname(current))
    parts.unshift(current);
  for (const current of parts) {
    try {
      await trusted(current, true);
    } catch (e) {
      if (e.code !== "ENOENT" || !create) throw e;
      await mkdir(current, { mode: 0o755 });
      await trusted(current, true);
    }
  }
}
async function optionalFile(target) {
  try {
    await trusted(target);
    return await readFile(target);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function atomic(target, content, mode = 0o600) {
  await rootDirectory(path.dirname(target));
  const temporary = target + "." + randomUUID() + ".partial";
  try {
    await writeFile(temporary, content, { flag: "wx", mode });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function command(file, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: ENV,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      tooLarge = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    timer.unref();
    child.stdout.on("data", (b) => {
      output += b.toString();
      if (output.length > 65536) {
        tooLarge = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new HelperError("command_failed", "os"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || tooLarge)
        reject(new HelperError("command_failed", "os"));
      else resolve(output);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
function dataMount(text) {
  const rows = text
    .trim()
    .split("\n")
    .map((line) => {
      const [a, b] = line.split(" - ");
      if (!a || !b) return null;
      const p = a.split(" ");
      return {
        target: p[4],
        device: p[2],
        options: p[5],
        type: b.split(" ")[0],
      };
    });
  const target = rows.filter((r) => r?.target === ROOT),
    system = rows.find((r) => r?.target === "/");
  if (
    target.length !== 1 ||
    !system ||
    target[0].device === system.device ||
    !["ext4", "xfs", "btrfs"].includes(target[0].type) ||
    !target[0].options.split(",").includes("rw")
  )
    throw new HelperError("data_disk_required", "disk");
}
async function disk() {
  await rootDirectory(ROOT);
  dataMount(await readFile("/proc/self/mountinfo", "utf8"));
  if ((await lstat(ROOT)).dev === (await lstat("/")).dev)
    throw new HelperError("data_disk_required", "disk");
}
async function config() {
  await rootDirectory("/etc/jweb");
  await trusted("/etc/jweb/helper.json");
  const s = await readFile("/etc/jweb/helper.json", "utf8");
  if (s.length > 4096) throw new HelperError("invalid_config");
  const c = JSON.parse(s);
  if (
    Object.keys(c).sort().join(",") !== "domainSuffix,tenant" ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(c.tenant) ||
    !/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(c.domainSuffix)
  )
    throw new HelperError("invalid_config");
  return c;
}
const statePath = (id) => STATE + "/" + id + ".json";
async function state(id, c) {
  const bytes = await optionalFile(statePath(id));
  if (!bytes || bytes.length > 4096)
    throw new HelperError("site_not_found", "lookup");
  const s = JSON.parse(bytes);
  if (
    s.siteId !== id ||
    s.tenant !== c.tenant ||
    ![
      "creating",
      "created",
      "account_creating",
      "account_ready",
      "active",
      "gateway_removed",
      "account_removed",
      "backup_pending",
      "deleted",
    ].includes(s.phase)
  )
    throw new HelperError("invalid_state", "lookup");
  validateRequest("site-create", { siteId: s.siteId, domain: s.domain });
  if (
    s.account !== null &&
    (typeof s.account !== "string" || !/^jw-[a-z0-9]{4,24}$/.test(s.account))
  )
    throw new HelperError("invalid_state");
  if (
    s.backupId !== undefined &&
    !new RegExp(
      "^" + id + "-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$",
    ).test(s.backupId)
  )
    throw new HelperError("invalid_state");
  return s;
}
async function save(s) {
  await atomic(statePath(s.siteId), JSON.stringify(s) + "\n");
}
async function states(c) {
  const names = await readdir(STATE);
  if (names.length > 10000) throw new HelperError("state_limit");
  const result = [];
  for (const name of names) {
    if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.json$/.test(name))
      result.push(await state(name.slice(0, -5), c));
  }
  return result;
}
const siteRoot = (id) => ROOT + "/sites/" + id;
async function siteDirectory(id) {
  await rootDirectory(siteRoot(id));
  const p = await lstat(siteRoot(id) + "/public");
  if (!p.isDirectory() || p.isSymbolicLink())
    throw new HelperError("unsafe_path", "filesystem");
}
async function uid(account, id) {
  const text = await command("/usr/bin/getent", ["passwd", account]);
  const p = text.trim().split(":");
  const n = Number(p[2]);
  if (
    p[0] !== account ||
    !Number.isInteger(n) ||
    n < 1000 ||
    p[5] !== siteRoot(id) ||
    p[6] !== "/usr/sbin/nologin"
  )
    throw new HelperError("unmanaged_account", "account");
  return n;
}
async function ftpUsers(c) {
  const accounts = (await states(c))
    .filter((s) => s.account !== null && s.phase !== "deleted")
    .map((s) => s.account)
    .sort();
  await atomic("/etc/jweb/ftps-users", accounts.join("\n") + "\n");
}
async function deleteAccount(s, c) {
  if (!s.account) {
    await ftpUsers(c);
    return;
  }
  let user;
  try {
    user = await uid(s.account, s.siteId);
  } catch (e) {
    if (e.code !== "command_failed") throw e;
    user = null;
  }
  if (user !== null) {
    await command("/usr/sbin/usermod", ["--lock", "--", s.account]);
    try {
      await command("/usr/bin/pkill", ["-TERM", "-u", String(user)]);
    } catch (e) {
      if (e.code !== "command_failed") throw e;
    }
    await command("/usr/sbin/userdel", ["--", s.account]);
  }
  await siteDirectory(s.siteId);
  await chown(siteRoot(s.siteId) + "/public", 0, 0);
  s.account = null;
  s.phase = "account_removed";
  await save(s);
  await ftpUsers(c);
}
export function renderSite(s) {
  validateRequest("site-create", { siteId: s.siteId, domain: s.domain });
  return `server {
 listen 443 ssl;
 server_name ${s.domain};
 ssl_certificate ${TLS}/sites/${s.siteId}.crt;
 ssl_certificate_key ${TLS}/sites/${s.siteId}.key;
 ssl_protocols TLSv1.2 TLSv1.3;
 root ${siteRoot(s.siteId)}/public;
 disable_symlinks on from=$document_root;
 autoindex off;
 add_header X-Content-Type-Options nosniff always;
 location ~ /\\. { return 404; }
 location / { try_files $uri $uri/index.html =404; }
}
`;
}
async function certificate(s) {
  await rootDirectory(TLS + "/sites", true);
  await trusted(TLS + "/ca.crt");
  await trusted(TLS + "/ca.key");
  const base = TLS + "/sites/" + s.siteId;
  if (await optionalFile(base + ".crt")) {
    await trusted(base + ".key");
    return;
  }
  const work = base + "." + randomUUID();
  try {
    await command("/usr/bin/openssl", [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      "/CN=" + s.domain,
      "-addext",
      "subjectAltName=DNS:" + s.domain,
      "-keyout",
      work + ".key",
      "-out",
      work + ".csr",
    ]);
    await chmod(work + ".key", 0o600);
    await command("/usr/bin/openssl", [
      "x509",
      "-req",
      "-in",
      work + ".csr",
      "-CA",
      TLS + "/ca.crt",
      "-CAkey",
      TLS + "/ca.key",
      "-set_serial",
      "0x" + randomUUID().replaceAll("-", ""),
      "-days",
      "30",
      "-copy_extensions",
      "copy",
      "-out",
      work + ".crt",
    ]);
    await rename(work + ".key", base + ".key");
    await rename(work + ".crt", base + ".crt");
  } finally {
    for (const ext of [".key", ".csr", ".crt"])
      await rm(work + ext, { force: true });
  }
}
async function changeBlocks(changes) {
  await rootDirectory(BLOCKS);
  const previous = new Map();
  for (const [id] of changes) {
    const file = BLOCKS + "/" + id + ".conf";
    previous.set(file, await optionalFile(file));
  }
  let phase = "nginx_write";
  try {
    for (const [id, content] of changes) {
      const file = BLOCKS + "/" + id + ".conf";
      if (content === null) await rm(file, { force: true });
      else await atomic(file, content, 0o644);
    }
    phase = "nginx_validation";
    await command("/usr/sbin/nginx", ["-t"]);
    phase = "nginx_reload";
    await command("/usr/sbin/nginx", ["-s", "reload"]);
  } catch {
    for (const [file, content] of previous) {
      if (content === null) await rm(file, { force: true });
      else await atomic(file, content, 0o644);
    }
    let rollbackReload = false;
    try {
      await command("/usr/sbin/nginx", ["-t"]);
      await command("/usr/sbin/nginx", ["-s", "reload"]);
      rollbackReload = true;
    } catch {}
    throw new HelperError(phase + "_failed", phase, {
      restored: true,
      rollbackReload,
    });
  }
}
async function backup(s) {
  await rootDirectory(ROOT + "/backups", true);
  const id = s.backupId ?? s.siteId + "-" + randomUUID();
  s.backupId = id;
  s.phase = "backup_pending";
  await save(s);
  const to = ROOT + "/backups/" + id;
  await rootDirectory(to, true);
  await chmod(to, 0o700);
  try {
    let moved = false;
    try {
      await trusted(to + "/site", true);
      moved = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (!moved) {
      await siteDirectory(s.siteId);
      await rename(siteRoot(s.siteId), to + "/site");
    } else {
      try {
        await lstat(siteRoot(s.siteId));
        throw new HelperError("backup_conflict");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    await atomic(to + "/metadata.json", JSON.stringify(s) + "\n");
    s.phase = "deleted";
    await save(s);
  } catch {
    throw new HelperError("backup_incomplete", "backup", { backupId: id });
  }
  return id;
}
async function remove(s, c) {
  if (s.phase === "deleted") {
    await ftpUsers(c);
    return s;
  }
  if (s.phase === "backup_pending") {
    await backup(s);
    return s;
  }
  await siteDirectory(s.siteId);
  await changeBlocks([[s.siteId, null]]);
  s.phase = "gateway_removed";
  await save(s);
  await deleteAccount(s, c);
  await backup(s);
  return s;
}
export async function runHelper(action, body) {
  validateRequest(action, body);
  if (process.getuid?.() !== 0) throw new HelperError("root_required");
  const c = await config();
  await disk();
  await rootDirectory(STATE, true);
  await chmod(STATE, 0o700);
  await rootDirectory(ROOT + "/sites", true);
  await rootDirectory(BLOCKS);
  await rootDirectory("/run");
  try {
    await mkdir(LOCK, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST") throw new HelperError("busy", "lock");
    throw e;
  }
  try {
    await writeFile(
      LOCK + "/owner.json",
      JSON.stringify({ pid: process.pid, token: randomUUID() }),
      { flag: "wx", mode: 0o600 },
    );
    if (action === "site-create") {
      if (
        !body.domain.endsWith(c.domainSuffix) ||
        [
          "auth.jgw.test",
          "console.jgw.test",
          "jauth.jgw.test",
          `gw.${c.tenant}.jgw.test`,
        ].includes(body.domain)
      )
        throw new HelperError("domain_not_allowed");
      const all = await states(c),
        old = all.find((s) => s.siteId === body.siteId);
      if (old) {
        if (old.domain !== body.domain || old.phase === "deleted")
          throw new HelperError("site_conflict");
        if (old.phase !== "creating") return old;
      }
      if (
        all.some(
          (s) =>
            s.siteId !== body.siteId &&
            s.phase !== "deleted" &&
            s.domain === body.domain,
        )
      )
        throw new HelperError("domain_conflict");
      const s = old ?? {
        siteId: body.siteId,
        tenant: c.tenant,
        domain: body.domain,
        account: null,
        phase: "creating",
      };
      if (!old) {
        try {
          await lstat(siteRoot(body.siteId));
          throw new HelperError("unmanaged_site");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        await save(s);
      }
      await rootDirectory(siteRoot(body.siteId), true);
      await rootDirectory(siteRoot(body.siteId) + "/public", true);
      s.phase = "created";
      await save(s);
      return s;
    }
    if (action === "retained-state") {
      const all = await states(c);
      if (all.some((s) => s.phase !== "deleted" || !s.backupId))
        throw new HelperError("cleanup_incomplete", "lookup");
      return {
        tenant: c.tenant,
        removed: 0,
        backups: all.map((s) => s.backupId).sort(),
      };
    }
    if (action === "remove-all") {
      const all = (await states(c)).filter((s) => s.phase !== "deleted");
      for (const s of all)
        if (s.phase !== "backup_pending") await siteDirectory(s.siteId);
      await changeBlocks(all.map((s) => [s.siteId, null]));
      for (const s of all) {
        if (s.phase !== "backup_pending") {
          s.phase = "gateway_removed";
          await save(s);
        }
      }
      const backups = [];
      for (const s of all) {
        if (s.phase !== "backup_pending") await deleteAccount(s, c);
        backups.push(await backup(s));
      }
      await ftpUsers(c);
      return { tenant: c.tenant, removed: all.length, backups };
    }
    const s = await state(body.siteId, c);
    if (action === "site-delete") return await remove(s, c);
    if (s.phase === "deleted" || s.phase === "backup_pending")
      throw new HelperError("site_not_found", "lookup");
    await siteDirectory(s.siteId);
    if (action === "account-create") {
      if (s.account !== null && s.account !== body.account)
        throw new HelperError("account_conflict");
      if (s.account !== null && s.phase !== "account_creating")
        throw new HelperError("account_exists", "account");
      let exists = false;
      try {
        await command("/usr/bin/getent", ["passwd", body.account]);
        exists = true;
      } catch (e) {
        if (e.code !== "command_failed") throw e;
      }
      if (exists && s.account === null)
        throw new HelperError("unmanaged_account", "account");
      if (exists) await uid(body.account, s.siteId);
      s.account = body.account;
      s.phase = "account_creating";
      await save(s);
      try {
        if (!exists)
          await command("/usr/sbin/useradd", [
            "--no-create-home",
            "--home-dir",
            siteRoot(s.siteId),
            "--shell",
            "/usr/sbin/nologin",
            "--gid",
            "jweb-sftp",
            "--",
            body.account,
          ]);
        await command(
          "/usr/sbin/chpasswd",
          [],
          `${body.account}:${body.password}\n`,
        );
        await chown(
          siteRoot(s.siteId) + "/public",
          await uid(body.account, s.siteId),
          Number(
            (await command("/usr/bin/getent", ["group", "jweb-sftp"])).split(
              ":",
            )[2],
          ),
        );
        s.phase = "account_ready";
        await save(s);
        await ftpUsers(c);
      } catch (e) {
        try {
          await command("/usr/sbin/userdel", ["--", body.account]);
          await chown(siteRoot(s.siteId) + "/public", 0, 0);
          s.account = null;
          s.phase = "created";
          await save(s);
          await ftpUsers(c);
        } catch {}
        throw e;
      }
      return s;
    }
    if (action === "account-passwd" || action === "account-delete") {
      if (s.account !== body.account)
        throw new HelperError("unmanaged_account", "account");
      if (action === "account-passwd") {
        await uid(s.account, s.siteId);
        await command(
          "/usr/sbin/chpasswd",
          [],
          `${s.account}:${body.password}\n`,
        );
      } else await deleteAccount(s, c);
      return s;
    }
    if (action === "nginx-apply") {
      if (!s.account || !["account_ready", "active"].includes(s.phase))
        throw new HelperError("account_required", "account");
      await uid(s.account, s.siteId);
      await certificate(s);
      await changeBlocks([[s.siteId, renderSite(s)]]);
      s.phase = "active";
      await save(s);
      return s;
    }
    throw new HelperError("invalid_request");
  } finally {
    await rm(LOCK, { recursive: true, force: true });
  }
}
async function main() {
  if (
    process.argv.length !== 3 ||
    fileURLToPath(import.meta.url) !== "/usr/local/sbin/jweb-helper"
  )
    throw new HelperError("invalid_invocation");
  await trusted("/usr/local/sbin/jweb-helper");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 8192) throw new HelperError("invalid_request");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const result = await runHelper(process.argv[2], value);
  delete result.password;
  process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    const safe =
      e instanceof HelperError
        ? e
        : new HelperError("helper_failed", "internal");
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code: safe.code,
        phase: safe.phase,
        ...safe.details,
      }) + "\n",
    );
    process.exitCode = 1;
  });
