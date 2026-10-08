import { describe, it, expect } from "vitest";
import { dedicatedMount } from "../../apps/server/src/disk.js";
const system = "1 0 0:1 / / rw - overlay overlay rw\n";
describe("fixed web data disk guard", () => {
  it("accepts a separate writable filesystem and rejects root binds, RAM, readonly and ambiguous mounts", () => {
    expect(
      dedicatedMount(system + "2 1 8:16 / /srv/jweb rw - ext4 /dev/sdb rw"),
    ).toEqual({ device: "8:16", type: "ext4" });
    for (const extra of [
      "",
      "2 1 0:1 / /srv/jweb rw - ext4 /dev/sda rw",
      "2 1 8:16 /somewhere /srv/jweb rw - ext4 /dev/sdb rw",
      "2 1 0:2 / /srv/jweb rw - tmpfs tmpfs rw",
      "2 1 8:16 / /srv/jweb ro - ext4 /dev/sdb ro",
      "2 1 8:16 / /srv/jweb rw - ext4 /dev/sdb rw\n3 1 8:17 / /srv/jweb rw - ext4 /dev/sdc rw",
    ])
      expect(() => dedicatedMount(system + extra)).toThrow();
  });
});
