import { chmod, chown, copyFile } from "node:fs/promises";

// The task override supplies the repository helper read-only. Copy it into the
// disposable container as root so the fixture exercises the normal sudo path.
await copyFile(
  "/opt/jweb-task25/jweb-helper.mjs",
  "/usr/local/sbin/jweb-helper",
);
await chown("/usr/local/sbin/jweb-helper", 0, 0);
await chmod("/usr/local/sbin/jweb-helper", 0o555);
await import("/opt/jweb-fixture/entrypoint.mjs");
