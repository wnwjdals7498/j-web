import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CONTENT_LIMITS, isSiteDomain } from "@j-web/contracts";
import {
  validateContent,
  renderPreview,
  renderSiteTemplate,
  widgetSnippet,
} from "../../apps/server/src/content.js";
const png = readFileSync(new URL("../fixtures/logo-rgba.png", import.meta.url));
const content = {
  name: "<script>alert(1)</script>",
  introduction: '<img src=x onerror="bad()">',
  contact: "&'\"<>",
  logo: null,
};
describe("bounded page input and inert static preview", () => {
  it("escapes every text context and always carries the fixed anonymous tenant snippet with scripts blocked", () => {
    const rendered = renderPreview("content-fixture", content);
    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&amp;&#39;&quot;&lt;&gt;");
    expect(rendered.html).toContain("script-src 'none'");
    expect(rendered.html.split(rendered.widgetSnippet)).toHaveLength(2);
    expect(widgetSnippet("content-fixture")).toBe(
      '<script src="https://gw.content-fixture.jgw.test/ext/talk/v1/widget.min.js" async></script>',
    );
    expect(() => widgetSnippet('bad" onerror=bad')).toThrow();
  });
  it("accepts an independent PNG raster and rejects SVG/URLs, corrupt CRC, truncation and oversized images", () => {
    const logo = {
      mimeType: "image/png" as const,
      base64: png.toString("base64"),
    };
    expect(validateContent({ ...content, logo }).logo).toEqual(logo);
    const corrupt = Buffer.from(png);
    corrupt[corrupt.length - 1]! ^= 1;
    for (const candidate of [
      {
        mimeType: "image/svg+xml",
        base64: Buffer.from('<svg onload="bad()"/>').toString("base64"),
      },
      { mimeType: "image/png", base64: "https://example.test/image.png" },
      { ...logo, base64: corrupt.toString("base64") },
      { ...logo, base64: png.subarray(0, png.length - 1).toString("base64") },
      {
        ...logo,
        base64: Buffer.alloc(CONTENT_LIMITS.logoBytes + 1).toString("base64"),
      },
    ])
      expect(() => validateContent({ ...content, logo: candidate })).toThrow();
  });
  it("rejects unknown fields, Unicode byte overflow and control text; retains exact content without turning contact into a URL", () => {
    for (const input of [
      { ...content, path: "/etc/passwd" },
      { ...content, name: " " },
      { ...content, name: "가".repeat(41) },
      { ...content, introduction: "bad\u0000" },
      {
        ...content,
        logo: { mimeType: "image/png", base64: "", path: "/tmp/file" },
      },
    ])
      expect(() => validateContent(input)).toThrow();
    expect(validateContent(content)).toEqual(content);
    expect(
      renderPreview("content-fixture", {
        ...content,
        contact: "javascript:bad()",
      }).html,
    ).not.toContain("href=");
  });
  it("shares lowercase RFC1123/suffix/reserved host checks", () => {
    expect(isSiteDomain("site.jgw.test", "tenant")).toBe(true);
    for (const value of [
      "Site.jgw.test",
      "-site.jgw.test",
      "x..jgw.test",
      "x.example.test",
      "gw.tenant.jgw.test",
      "auth.jgw.test",
      "site.jgw.test/path",
    ])
      expect(isSiteDomain(value, "tenant")).toBe(false);
  });
  it("renders only the saved text as escaped markup and deploys one revision-tagged index with the widget", () => {
    const rendered = renderSiteTemplate("content-fixture", content, 7);
    expect(rendered).toContain(
      "<!doctype html>\n<!-- j-web-managed-template:v1 revision:7 -->",
    );
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered).not.toContain("<img src=x onerror");
    expect(rendered).toContain("<style>");
    expect(rendered).toContain(
      "gw.content-fixture.jgw.test/ext/talk/v1/widget.min.js",
    );
    expect(rendered).not.toContain("preview");
    expect(() => renderSiteTemplate("content-fixture", content, 0)).toThrow();
  });
});
