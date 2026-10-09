import { inflateSync } from "node:zlib";
import { assertCustomerTenantId } from "@j-auth/contracts";
import { CONTENT_LIMITS } from "@j-web/contracts";
import type {
  PageContent,
  ContentView,
  ContentWrite,
  PreviewView,
} from "@j-web/contracts";
import type { Pool } from "pg";
import { ApiError, missing } from "./errors.js";
const invalid = () =>
  new ApiError(400, "invalid_content", "Invalid page content.");
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  Boolean(v) &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v!).sort().join(",") === [...keys].sort().join(",");
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Static 8-bit RGB/RGBA PNG only. Canonical base64, checksums and bounded inflate
// prevent URL/SVG/animation/oversized raster payloads without an OS image tool.
function logo(input: unknown): PageContent["logo"] {
  if (input === null) return null;
  if (
    !exact(input, ["mimeType", "base64"]) ||
    input.mimeType !== "image/png" ||
    typeof input.base64 !== "string" ||
    input.base64.length > Math.ceil(CONTENT_LIMITS.logoBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input.base64,
    )
  )
    throw invalid();
  const bytes = Buffer.from(input.base64, "base64");
  if (
    bytes.length > CONTENT_LIMITS.logoBytes ||
    bytes.toString("base64") !== input.base64 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw invalid();
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false,
    dataClosed = false;
  const chunks: Buffer[] = [];
  while (offset < bytes.length) {
    if (ended || offset + 12 > bytes.length) throw invalid();
    const size = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8),
      end = offset + 12 + size;
    if (
      end > bytes.length ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw invalid();
    const value = bytes.subarray(offset + 8, end - 4);
    if (offset === 8) {
      if (type !== "IHDR" || size !== 13) throw invalid();
      width = value.readUInt32BE(0);
      height = value.readUInt32BE(4);
      channels = value[9] === 2 ? 3 : value[9] === 6 ? 4 : 0;
      if (
        !width ||
        !height ||
        width > CONTENT_LIMITS.logoDimension ||
        height > CONTENT_LIMITS.logoDimension ||
        value[8] !== 8 ||
        !channels ||
        value[10] !== 0 ||
        value[11] !== 0 ||
        value[12] !== 0
      )
        throw invalid();
    } else if (type === "IDAT") {
      if (dataClosed) throw invalid();
      chunks.push(value);
    } else if (type === "IEND") {
      if (size || !chunks.length) throw invalid();
      ended = true;
    } else {
      if (chunks.length) dataClosed = true;
      // Metadata is neither needed nor copied into markup. Reject all extensions
      // rather than accepting unvalidated animation or critical format changes.
      throw invalid();
    }
    offset = end;
  }
  if (!ended) throw invalid();
  const stride = width * channels + 1,
    expected = stride * height;
  let raw: Buffer;
  try {
    const result = inflateSync(Buffer.concat(chunks), {
      maxOutputLength: expected,
      info: true,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    raw = result.buffer;
    if (result.engine.bytesWritten !== Buffer.concat(chunks).length)
      throw invalid();
  } catch {
    throw invalid();
  }
  if (raw.length !== expected) throw invalid();
  for (let row = 0; row < height; row++)
    if (raw[row * stride]! > 4) throw invalid();
  return { mimeType: "image/png", base64: input.base64 };
}
export function validateContent(input: unknown): PageContent {
  if (!exact(input, ["name", "introduction", "contact", "logo"]))
    throw invalid();
  const text = (key: "name" | "introduction" | "contact") => {
    const value = input[key];
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value) > CONTENT_LIMITS[key] ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uD800-\uDFFF]/u.test(value) ||
      (key === "name" && !value.trim())
    )
      throw invalid();
    return value;
  };
  return {
    name: text("name"),
    introduction: text("introduction"),
    contact: text("contact"),
    logo: logo(input.logo),
  };
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (v) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        v
      ]!,
  );
export function widgetSnippet(tenant: string) {
  assertCustomerTenantId(tenant);
  return `<script src="https://gw.${tenant}.jgw.test/ext/talk/v1/widget.min.js" async></script>`;
}
export function renderPreview(tenant: string, input: unknown) {
  const c = validateContent(input),
    snippet = widgetSnippet(tenant);
  // Read-only preview carries the exact eventual snippet but blocks all scripts,
  // forms, network fetches and navigation. Public deployment remains unbound.
  return {
    widgetSnippet: snippet,
    html: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(c.name)}</title></head><body><main>${c.logo ? `<img alt="" src="data:image/png;base64,${c.logo.base64}">` : ""}<h1>${escape(c.name)}</h1><p>${escape(c.introduction)}</p><p>${escape(c.contact)}</p></main>${snippet}</body></html>`,
  };
}
export class ContentStore {
  constructor(
    private readonly pool: Pool,
    private readonly tenant: string,
  ) {
    assertCustomerTenantId(tenant);
  }
  private async site(id: string) {
    const r = await this.pool.query<{ domain: string }>(
      "SELECT domain FROM sites WHERE tenant_id=$1 AND site_id=$2",
      [this.tenant, id],
    );
    if (!r.rows[0]) throw missing();
    return r.rows[0];
  }
  async read(id: string): Promise<ContentView> {
    const r = await this.pool.query<{
      revision: number | null;
      content: PageContent | null;
    }>(
      "SELECT c.revision,c.content FROM sites s LEFT JOIN site_content c USING(tenant_id,site_id) WHERE s.tenant_id=$1 AND s.site_id=$2",
      [this.tenant, id],
    );
    if (!r.rows[0]) throw missing();
    return {
      siteId: id,
      revision: r.rows[0]?.revision ?? 0,
      content: r.rows[0].content ? validateContent(r.rows[0].content) : null,
    };
  }
  async save(id: string, input: ContentWrite): Promise<ContentView> {
    const content = validateContent(input.content);
    if (
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision >= 2147483647
    )
      throw invalid();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
        [this.tenant + ":web-site:" + id],
      );
      if (!lock.rows[0]?.locked)
        throw new ApiError(409, "site_busy", "Site operation already running.");
      const site = await client.query<{ state: string }>(
        "SELECT state FROM sites WHERE tenant_id=$1 AND site_id=$2 FOR UPDATE",
        [this.tenant, id],
      );
      if (!site.rows[0]) throw missing();
      if (site.rows[0].state === "deleting")
        throw new ApiError(409, "invalid_state", "Site is being removed.");
      const r = await client.query<{ revision: number }>(
        "SELECT revision FROM site_content WHERE tenant_id=$1 AND site_id=$2 FOR UPDATE",
        [this.tenant, id],
      );
      if ((r.rows[0]?.revision ?? 0) !== input.expectedRevision)
        throw new ApiError(
          409,
          "content_conflict",
          "Content changed. Reload before saving.",
        );
      const revision = input.expectedRevision + 1;
      await client.query(
        "INSERT INTO site_content(tenant_id,site_id,revision,content) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,site_id) DO UPDATE SET revision=EXCLUDED.revision,content=EXCLUDED.content",
        [this.tenant, id, revision, JSON.stringify(content)],
      );
      await client.query("COMMIT");
      return { siteId: id, revision, content };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async preview(id: string, content: unknown): Promise<PreviewView> {
    const site = await this.site(id);
    return {
      siteId: id,
      origin: "https://" + site.domain,
      ...renderPreview(this.tenant, content),
    };
  }
}
