export const WEB_PATHS = {
  sites: "/web/sites",
  hosting: "/web/sites/hosting",
} as const;
export const CONTENT_LIMITS = {
  name: 120,
  introduction: 4096,
  contact: 512,
  logoBytes: 1048576,
  logoDimension: 1024,
} as const;
export interface PageContent {
  name: string;
  introduction: string;
  contact: string;
  logo: { mimeType: "image/png"; base64: string } | null;
}
export interface ContentView {
  siteId: string;
  revision: number;
  content: PageContent | null;
}
export interface ContentWrite {
  expectedRevision: number;
  content: PageContent;
}
export interface PreviewView {
  siteId: string;
  origin: string;
  html: string;
  widgetSnippet: string;
}
export interface DnsAdvice {
  type: "A";
  name: string;
  address: string | null;
  guidance: "DNS는 등록처·DNS 서비스에서 별도 관리합니다.";
  hostsEntry: string | null;
}
export interface SiteList {
  items: SiteView[];
  next: string | null;
}
export interface HostingList {
  items: SiteHostingView[];
  next: string | null;
}
export interface SiteCreate {
  domain: string;
  password?: string;
}
export interface AccountPasswordResult {
  id: string;
  account: string;
  password: string;
}
export interface SiteDeleteResult {
  id: string;
  backupId: string;
}
export interface WebError {
  code: string;
  message: string;
  requestId: string;
  siteId?: string;
  phase?: string;
}
export interface DeploymentWrite {
  expectedRevision: number;
}
/** Exact saved revision; manual/unmanaged index changes produce a conflict. */
export interface DeploymentView {
  siteId: string;
  revision: number;
  origin: string;
  deployed: boolean;
  /** Opaque private backup identifier, never a filesystem path. */
  previousVersion: string | null;
}
export function isSiteDomain(
  value: unknown,
  tenant: string,
  suffix = ".jgw.test",
): value is string {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) &&
    value
      .split(".")
      .every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          !label.startsWith("-") &&
          !label.endsWith("-"),
      ) &&
    value.endsWith(suffix) &&
    ![
      "auth.jgw.test",
      "jauth.jgw.test",
      "console.jgw.test",
      `gw.${tenant}.jgw.test`,
    ].includes(value)
  );
}
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
