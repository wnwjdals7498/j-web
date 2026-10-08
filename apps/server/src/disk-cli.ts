import { probeDataDisk } from "./disk.js";
if (process.argv.length !== 2) {
  process.stderr.write("Data disk probe accepts no arguments.\n");
  process.exitCode = 1;
} else
  try {
    process.stdout.write(JSON.stringify(await probeDataDisk()) + "\n");
  } catch {
    process.stderr.write(
      "A separate writable /srv/jweb data disk is required. No files were written.\n",
    );
    process.exitCode = 1;
  }
