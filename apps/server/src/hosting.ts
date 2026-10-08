import { randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Pool, PoolClient } from "pg";
import type { SiteView } from "@j-web/contracts";
import { ApiError, missing } from "./errors.js";
import { probeDataDisk, measureSiteUsage } from "./disk.js";
import { SudoHostingHelper } from "./hosting-helper.js";
import type { HostingHelper, HelperAction } from "./hosting-helper.js";
export interface WebDisk {
  probe(): ReturnType<typeof probeDataDisk>;
  usage(id: string): Promise<string>;
}
interface StoredSite extends SiteView {
  account: string | null;
  phase: string;
}
const select =
  "SELECT site_id AS id, domain, state, account_name AS account, operation_phase AS phase FROM sites WHERE tenant_id=$1 AND site_id=$2";
export class Hosting {
  private readonly helper: HostingHelper;
  private readonly disk: WebDisk;
  constructor(
    private readonly options: {
      pool: Pool;
      tenant: string;
      helper?: HostingHelper;
      disk?: WebDisk;
      domainSuffix?: string;
      customerAddress?: string;
    },
  ) {
    if (options.customerAddress && isIP(options.customerAddress) !== 4)
      throw new Error("Invalid customer address.");
    if (
      options.domainSuffix &&
      !/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(options.domainSuffix)
    )
      throw new Error("Invalid domain suffix.");
    this.helper = options.helper ?? new SudoHostingHelper();
    this.disk = options.disk ?? {
      probe: probeDataDisk,
      usage: measureSiteUsage,
    };
  }
  private async mounted() {
    try {
      return await this.disk.probe();
    } catch {
      throw new ApiError(
        503,
        "data_disk_required",
        "Separate web data disk unavailable.",
      );
    }
  }
  private password(input?: string) {
    const value = input ?? randomBytes(24).toString("base64url");
    if (
      value.length < 12 ||
      Buffer.byteLength(value) > 256 ||
      /[\x00-\x1f\x7f:]/u.test(value)
    )
      throw new ApiError(400, "invalid_password", "Invalid account password.");
    return value;
  }
  private async locked<T>(
    id: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.options.pool.connect();
    let locked = false,
      discard = false;
    const key = this.options.tenant + ":web-site:" + id;
    try {
      locked = (
        await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [key],
        )
      ).rows[0]!.locked;
      if (!locked)
        throw new ApiError(409, "site_busy", "Site operation already running.");
      return await operation(client);
    } finally {
      if (locked)
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [key],
          );
        } catch {
          discard = true;
        }
      client.release(discard);
    }
  }
  private async row(client: PoolClient, id: string) {
    const result = await client.query<StoredSite>(select, [
      this.options.tenant,
      id,
    ]);
    if (!result.rows[0]) throw missing();
    return result.rows[0];
  }
  private async step(
    client: PoolClient,
    id: string,
    phase: string,
    action: HelperAction,
    body: Record<string, string>,
  ) {
    await client.query(
      "UPDATE sites SET operation_phase=$3,last_error=NULL WHERE tenant_id=$1 AND site_id=$2",
      [this.options.tenant, id, phase],
    );
    try {
      const result = await this.helper.run(action, body);
      if (!result.ok) {
        const code =
          result.code && /^[a-z0-9_]{1,64}$/.test(result.code)
            ? result.code
            : "helper_failed";
        await client.query(
          "UPDATE sites SET state='failed',last_error=$3 WHERE tenant_id=$1 AND site_id=$2",
          [this.options.tenant, id, code],
        );
        throw new ApiError(
          503,
          code,
          "Site operation incomplete. Retry this site.",
          id,
          phase,
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      await client.query(
        "UPDATE sites SET state='failed',last_error='helper_unavailable' WHERE tenant_id=$1 AND site_id=$2",
        [this.options.tenant, id],
      );
      throw new ApiError(
        503,
        "helper_unavailable",
        "Site operation incomplete. Retry this site.",
        id,
        phase,
      );
    }
  }
  private async setup(client: PoolClient, site: StoredSite, password: string) {
    await this.step(client, site.id, "site_create", "site-create", {
      siteId: site.id,
      domain: site.domain,
    });
    const account =
      site.account ?? "jw-" + site.id.replaceAll("-", "").slice(0, 20);
    await client.query(
      "UPDATE sites SET account_name=$3 WHERE tenant_id=$1 AND site_id=$2",
      [this.options.tenant, site.id, account],
    );
    try {
      await this.step(client, site.id, "account_create", "account-create", {
        siteId: site.id,
        account,
        password,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "account_exists")
        throw error;
      await this.step(client, site.id, "account_create", "account-passwd", {
        siteId: site.id,
        account,
        password,
      });
    }
    await this.step(client, site.id, "nginx_apply", "nginx-apply", {
      siteId: site.id,
    });
    await client.query(
      "UPDATE sites SET state='active',operation_phase='active',last_error=NULL WHERE tenant_id=$1 AND site_id=$2",
      [this.options.tenant, site.id],
    );
    return {
      id: site.id,
      domain: site.domain,
      state: "active" as const,
      account,
      password,
    };
  }
  async create(domain: string, inputPassword?: string) {
    if (
      domain.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
      domain
        .split(".")
        .some(
          (label) =>
            !label ||
            label.length > 63 ||
            label.startsWith("-") ||
            label.endsWith("-"),
        ) ||
      !domain.endsWith(this.options.domainSuffix ?? ".jgw.test") ||
      [
        "auth.jgw.test",
        "jauth.jgw.test",
        "console.jgw.test",
        `gw.${this.options.tenant}.jgw.test`,
      ].includes(domain)
    )
      throw new ApiError(400, "invalid_domain", "Invalid site domain.");
    const password = this.password(inputPassword);
    await this.mounted();
    const id = randomUUID();
    return this.locked(id, async (client) => {
      try {
        await client.query(
          "INSERT INTO sites(tenant_id,site_id,domain,state,operation_phase) VALUES ($1,$2,$3,'creating','site_create')",
          [this.options.tenant, id, domain],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw new ApiError(
            409,
            "domain_conflict",
            "Site domain already exists.",
          );
        throw error;
      }
      return this.setup(client, await this.row(client, id), password);
    });
  }
  async retry(id: string, inputPassword?: string) {
    return this.locked(id, async (client) => {
      const site = await this.row(client, id);
      if (
        site.state === "active" ||
        site.phase === "delete" ||
        site.phase === "unmanaged"
      )
        throw new ApiError(409, "invalid_state", "Site cannot be retried.");
      await this.mounted();
      return this.setup(client, site, this.password(inputPassword));
    });
  }
  async resetPassword(id: string, inputPassword?: string) {
    return this.locked(id, async (client) => {
      const site = await this.row(client, id);
      if (site.state !== "active" || !site.account)
        throw new ApiError(409, "invalid_state", "Site account unavailable.");
      await this.mounted();
      const password = this.password(inputPassword);
      await this.step(client, id, "active", "account-passwd", {
        siteId: id,
        account: site.account,
        password,
      });
      return { id, account: site.account, password };
    });
  }
  async remove(id: string) {
    return this.locked(id, async (client) => {
      await this.row(client, id);
      await this.mounted();
      await client.query(
        "UPDATE sites SET state='deleting' WHERE tenant_id=$1 AND site_id=$2",
        [this.options.tenant, id],
      );
      const result = await this.step(client, id, "delete", "site-delete", {
        siteId: id,
      });
      await client.query(
        "DELETE FROM sites WHERE tenant_id=$1 AND site_id=$2",
        [this.options.tenant, id],
      );
      return { id, backupId: result.backupId };
    });
  }
  async details(id: string) {
    const result = await this.options.pool.query<
      StoredSite & { error: string | null }
    >(select.replace(" FROM sites", ", last_error AS error FROM sites"), [
      this.options.tenant,
      id,
    ]);
    const site = result.rows[0];
    if (!site) throw missing();
    const disk = await this.mounted();
    let usedBytes: string | null = null;
    if (
      site.phase !== "unmanaged" &&
      site.phase !== "site_create" &&
      site.phase !== "delete" &&
      site.state !== "deleting"
    )
      try {
        usedBytes = await this.disk.usage(id);
      } catch {
        throw new ApiError(
          503,
          "usage_unavailable",
          "Site disk usage unavailable.",
        );
      }
    return {
      ...site,
      usedBytes,
      disk: {
        filesystem: disk.filesystem,
        totalBytes: disk.totalBytes,
        availableBytes: disk.availableBytes,
      },
      origin: "https://" + site.domain,
      sftp: { port: 2222, account: site.account },
      ftps: { port: 21, passivePorts: [56110, 56119], account: site.account },
      dns: {
        type: "A",
        name: site.domain,
        address: this.options.customerAddress ?? null,
      },
    };
  }
}
