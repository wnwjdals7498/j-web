import { mkdir, writeFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
const tenant = process.env.JWEB_TEST_TENANT;
if (
  process.env.JWEB_TEST_RUNTIME !== "isolated-cloud" ||
  !/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant ?? "")
)
  throw new Error("Owned cloud fixture required.");
const run = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Fixture command failed.")),
    );
  });
await mkdir("/run/sshd", { recursive: true });
await run("/usr/bin/mknod", ["/dev/loop-control", "c", "10", "237"]);
for (let i = 0; i < 16; i++)
  await run("/usr/bin/mknod", [
    "-m",
    "600",
    "/dev/loop" + i,
    "b",
    "7",
    String(i),
  ]);
await run("/usr/bin/truncate", ["--size=64M", "/tmp/jweb-fixture.ext4"]);
await run("/usr/sbin/mkfs.ext4", ["-q", "/tmp/jweb-fixture.ext4"]);
await run("/usr/bin/mount", [
  "-t",
  "ext4",
  "-o",
  "loop,nodev,nosuid",
  "/tmp/jweb-fixture.ext4",
  "/srv/jweb",
]);
await mkdir("/etc/jweb/tls/sites", { recursive: true });
await writeFile(
  "/etc/jweb/helper.json",
  JSON.stringify({ tenant, domainSuffix: ".jgw.test" }),
  { mode: 0o600 },
);
await writeFile("/etc/jweb/ftps-users", "", { mode: 0o600 });
await writeFile(
  "/etc/pam.d/jweb-ftps",
  "auth required pam_unix.so\naccount required pam_unix.so\n",
  { mode: 0o644 },
);
await run("/usr/bin/openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-subj",
  "/CN=Isolated j-web fixture CA",
  "-days",
  "2",
  "-keyout",
  "/etc/jweb/tls/ca.key",
  "-out",
  "/etc/jweb/tls/ca.crt",
]);
await chmod("/etc/jweb/tls/ca.key", 0o600);
await run("/usr/bin/openssl", [
  "req",
  "-new",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-subj",
  "/CN=fixture.jgw.test",
  "-addext",
  "subjectAltName=DNS:fixture.jgw.test,DNS:localhost,IP:127.0.0.1",
  "-keyout",
  "/etc/jweb/tls/ftps.key",
  "-out",
  "/etc/jweb/tls/ftps.csr",
]);
await chmod("/etc/jweb/tls/ftps.key", 0o600);
await run("/usr/bin/openssl", [
  "x509",
  "-req",
  "-in",
  "/etc/jweb/tls/ftps.csr",
  "-CA",
  "/etc/jweb/tls/ca.crt",
  "-CAkey",
  "/etc/jweb/tls/ca.key",
  "-set_serial",
  "1",
  "-days",
  "2",
  "-copy_extensions",
  "copy",
  "-out",
  "/etc/jweb/tls/ftps.crt",
]);
await run("/usr/bin/ssh-keygen", ["-A"]);
await writeFile(
  "/etc/nginx/conf.d/jweb.conf",
  `include /etc/nginx/jweb.d/*.conf;\nserver { listen 443 ssl default_server; server_name fixture.jgw.test; ssl_certificate /etc/jweb/tls/ftps.crt; ssl_certificate_key /etc/jweb/tls/ftps.key; location / { return 200 'gateway-preserved'; } }\n`,
  { mode: 0o644 },
);
await run("/usr/sbin/nginx", ["-t"]);
await run("/usr/sbin/sshd", ["-t", "-f", "/etc/jweb/sshd_config"]);
const daemons = [
  ["/usr/sbin/nginx", ["-g", "daemon off;"]],
  ["/usr/sbin/sshd", ["-D", "-e", "-f", "/etc/jweb/sshd_config"]],
  ["/usr/sbin/vsftpd", ["/etc/jweb/vsftpd.conf"]],
].map(([file, args]) => spawn(file, args, { shell: false, stdio: "ignore" }));
for (const daemon of daemons)
  daemon.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      shutdown();
    }
  });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const closed = daemons
    .filter((daemon) => daemon.exitCode === null && daemon.signalCode === null)
    .map((daemon) => once(daemon, "exit"));
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(closed);
  await run("/usr/bin/umount", ["/srv/jweb"]);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await writeFile("/run/jweb-fixture.ready", "isolated-cloud\n", { mode: 0o600 });
