import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
export async function hostingRuntime(tenant) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant))
    throw new Error("Owned tenant required.");
  const project = "jweb-test-" + randomUUID().slice(0, 8);
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const env = {
    ...process.env,
    JWEB_TEST_TENANT: tenant,
    DOCKER_CONFIG:
      process.env.DOCKER_CONFIG ?? "/workspace/.suite-runtime/docker-build",
  };
  const composeArgs = [
    "compose",
    "-p",
    project,
    "-f",
    "deploy/hosting/compose.test.yaml",
  ];
  async function run(args, input = "", acceptFailure = false) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", args, {
        cwd: repository,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const chunks = [];
      let length = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), 65000);
      timer.unref();
      child.stdout.on("data", (chunk) => {
        length += chunk.length;
        if (length > 65536) child.kill("SIGKILL");
        else chunks.push(chunk);
      });
      child.stderr.on("data", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("Docker fixture unavailable."));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (length > 65536 || (code !== 0 && !acceptFailure))
          reject(new Error("Actual hosting command failed."));
        else resolve({ code, output: Buffer.concat(chunks).toString("utf8") });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
  const close = async () => {
    await run([...composeArgs, "down", "--volumes", "--remove-orphans"]);
  };
  try {
    await run([
      ...composeArgs,
      "up",
      "--detach",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "40",
    ]);
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  const container = (
    await run([...composeArgs, "ps", "-q", "hosting"])
  ).output.trim();
  if (!container) throw new Error("Owned hosting fixture absent.");
  const exec = (args, input = "", failure = false, user = "root") =>
    run(
      ["exec", "--interactive", "--user", user, container, ...args],
      input,
      failure,
    );
  const helper = async (action, body, user = "jweb") => {
    const result = await exec(
      user === "jweb"
        ? [
            "/usr/bin/sudo",
            "--non-interactive",
            "--",
            "/usr/local/sbin/jweb-helper",
            action,
          ]
        : ["/usr/local/sbin/jweb-helper", action],
      JSON.stringify(body),
      true,
      user,
    );
    const value = JSON.parse(result.output);
    if (value.ok ? result.code !== 0 : result.code === 0)
      throw new Error("Helper exit/result disagree.");
    return value;
  };
  const protocols = async (body) => {
    const result = await exec(
      ["python3", "/opt/jweb-fixture/protocols.py"],
      JSON.stringify(body),
      true,
    );
    const value = JSON.parse(result.output);
    if (result.code !== 0 || !value.ok)
      throw new Error(
        "Actual protocol " + value.action + " failed: " + value.reason,
      );
    return value;
  };
  const disk = {
    probe: async () =>
      JSON.parse(
        (
          await exec(
            [
              "node",
              "--input-type=module",
              "-e",
              "import {probeDataDisk} from '/opt/jweb-fixture/server/disk.js'; console.log(JSON.stringify(await probeDataDisk()))",
            ],
            "",
            false,
            "jweb",
          )
        ).output,
      ),
    usage: async (id) => {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid fixture site.");
      return JSON.parse(
        (
          await exec(
            [
              "node",
              "--input-type=module",
              "-e",
              "import {measureSiteUsage} from '/opt/jweb-fixture/server/disk.js'; console.log(JSON.stringify(await measureSiteUsage(process.argv[1])))",
              id,
            ],
            "",
            false,
            "jweb",
          )
        ).output,
      );
    },
  };
  return { helper, protocols, exec, disk, close, container };
}
