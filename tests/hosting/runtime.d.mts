import type { WebDisk } from "../../apps/server/src/hosting.js";
import type { HostingHelper } from "../../apps/server/src/hosting-helper.js";
export interface HostingFixture {
  helper: HostingHelper["run"];
  disk: WebDisk;
  protocols(body: Record<string, unknown>): Promise<{ ok: boolean }>;
  exec(
    args: string[],
    input?: string,
    failure?: boolean,
    user?: string,
  ): Promise<{ code: number | null; output: string }>;
  close(): Promise<void>;
  container: string;
}
export function hostingRuntime(tenant: string): Promise<HostingFixture>;
