import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const registry = "http://127.0.0.1:4873/";
async function run(args, cwd, userconfig) {
  if (!process.env.npm_execpath)
    throw new Error("Run through npm test:registry.");
  const child = spawn(
    process.execPath,
    [
      process.env.npm_execpath,
      ...args,
      "--registry",
      registry,
      "--userconfig",
      userconfig,
      "--cache",
      path.join(cwd, "cache"),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  child.stdout.on("data", (chunk) => (out += String(chunk)));
  child.stderr.resume();
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  timer.unref();
  try {
    const [code] = await once(child, "exit");
    if (code !== 0)
      throw new Error(
        `Registry CLI failed (${code}); private output withheld.`,
      );
    return out;
  } finally {
    clearTimeout(timer);
  }
}
test(
  "actual private-registry exact-version consumer matches the immutable built contracts",
  { timeout: 45000 },
  async () => {
    const profile = await realpath(
      process.env.JW_TEST_NPMRC ??
        path.resolve(root, "../.suite-runtime/j-groupware/registry/user.npmrc"),
    );
    assert.ok(
      path.relative(root, profile).startsWith(".." + path.sep),
      "Private registry profile must be outside checkout.",
    );
    const temporary = await mkdtemp(path.join(os.tmpdir(), "j-web-registry-"));
    try {
      const response = await fetch(registry + "@j-web%2fcontracts", {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(
        response.status,
        200,
        "Contracts must actually be published in the local registry.",
      );
      const metadata = await response.json(),
        version = JSON.parse(
          await readFile(
            path.join(root, "packages/contracts/package.json"),
            "utf8",
          ),
        ).version,
        manifest = metadata.versions[version];
      assert.equal(manifest.name, "@j-web/contracts");
      assert.equal(manifest.version, version);
      const packed = JSON.parse(
        await run(
          [
            "pack",
            path.join(root, "packages/contracts"),
            "--json",
            "--pack-destination",
            temporary,
          ],
          temporary,
          profile,
        ),
      );
      const bytes = await readFile(path.join(temporary, packed[0].filename));
      assert.equal(
        manifest.dist.integrity,
        "sha512-" + createHash("sha512").update(bytes).digest("base64"),
        "Published code must match this checkout; never republish a changed version.",
      );
      await writeFile(
        path.join(temporary, "package.json"),
        JSON.stringify({
          name: "isolated-mail-consumer",
          private: true,
          type: "module",
          dependencies: { "@j-web/contracts": version },
        }),
      );
      await run(["install"], temporary, profile);
      const lock = JSON.parse(
        await readFile(path.join(temporary, "package-lock.json"), "utf8"),
      );
      const entry = lock.packages["node_modules/@j-web/contracts"];
      assert.equal(entry.version, version);
      assert.equal(new URL(entry.resolved).origin, new URL(registry).origin);
      assert.equal(entry.integrity, manifest.dist.integrity);
      const contracts = await import(
        path.join(temporary, "node_modules/@j-web/contracts/dist/index.js")
      );
      assert.equal(contracts.WEB_PATHS.sites, "/web/sites");
      assert.equal(contracts.WEB_PATHS.hosting, "/web/sites/hosting");
      assert.equal(contracts.CONTENT_LIMITS.logoBytes, 1048576);
      assert.equal(contracts.isSiteDomain("site.jgw.test", "tenant"), true);
      assert.equal(
        contracts.isSiteDomain("gw.tenant.jgw.test", "tenant"),
        false,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
