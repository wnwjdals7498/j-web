import { readFile, lstat, statfs } from "node:fs/promises";
import path from "node:path";
export const DATA_DISK_ROOT = "/srv/jweb";
const decode = (value: string) =>
  value.replace(/\\(040|011|012|134)/g, (_match, digits: string) =>
    String.fromCharCode(parseInt(digits, 8)),
  );
export function dedicatedMount(
  mountinfo: string,
  root = DATA_DISK_ROOT,
): { device: string; type: string } {
  const entries = mountinfo
    .trim()
    .split("\n")
    .map((line) => {
      const split = line.split(" - ");
      if (split.length !== 2) return null;
      const before = split[0]!.split(" "),
        after = split[1]!.split(" ");
      return {
        target: decode(before[4] ?? ""),
        device: before[2] ?? "",
        subtree: decode(before[3] ?? ""),
        type: after[0] ?? "",
        options: before[5] ?? "",
      };
    });
  const target = entries.filter((entry) => entry?.target === root);
  const system = entries.find((entry) => entry?.target === "/");
  if (target.length !== 1 || !system)
    throw new Error("Dedicated web data disk is not mounted.");
  const selected = target[0]!;
  if (
    selected.device === system.device ||
    selected.subtree !== "/" ||
    !["ext4", "xfs", "btrfs"].includes(selected.type) ||
    !selected.options.split(",").includes("rw")
  )
    throw new Error("Require a writable separate data filesystem.");
  return { device: selected.device, type: selected.type };
}
export async function probeDataDisk() {
  // The product root is fixed and cannot be supplied by HTTP, argv or environment.
  for (
    let current: string = DATA_DISK_ROOT;
    current !== "/";
    current = path.dirname(current)
  ) {
    const value = await lstat(current);
    if (value.isSymbolicLink() || !value.isDirectory())
      throw new Error("Unsafe data disk path.");
  }
  const mount = dedicatedMount(await readFile("/proc/self/mountinfo", "utf8"));
  const data = await lstat(DATA_DISK_ROOT),
    system = await lstat("/");
  if (data.dev === system.dev)
    throw new Error("System filesystem cannot host web site data.");
  const usage = await statfs(DATA_DISK_ROOT, { bigint: true });
  return {
    root: DATA_DISK_ROOT,
    filesystem: mount.type,
    totalBytes: (usage.blocks * usage.bsize).toString(),
    availableBytes: (usage.bavail * usage.bsize).toString(),
  };
}
