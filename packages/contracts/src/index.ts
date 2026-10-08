export const WEB_PATHS = { sites: "/web/sites" } as const;
export type SiteState = "creating" | "active" | "deleting" | "failed";
export interface SiteView {
  id: string;
  domain: string;
  state: SiteState;
}
export interface SiteMutationResult extends SiteView {
  account: string;
  /** Present only on successful creation/retry/password-reset responses. */
  password: string;
}
export interface SiteHostingView extends SiteView {
  account: string | null;
  phase: string;
  error: string | null;
  usedBytes: string | null;
  disk: { filesystem: string; totalBytes: string; availableBytes: string };
  origin: string;
  sftp: { port: 2222; account: string | null };
  ftps: { port: 21; passivePorts: [56110, 56119]; account: string | null };
  dns: { type: "A"; name: string; address: string | null };
}
