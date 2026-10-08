export const WEB_PATHS = { sites: "/web/sites" } as const;
export type SiteState = "creating" | "active" | "deleting" | "failed";
export interface SiteView {
  id: string;
  domain: string;
  state: SiteState;
}
