import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, renderSite } from "../../deploy/jweb-helper.mjs";
const siteId = "53f3347d-e3b7-43dd-88a7-213d5fa0de44";
test("privileged helper rejects unsupported fields, traversal, config and account injection", () => {
  for (const [command, body] of [
    ["sh", {}],
    ["remove-all", { path: "/" }],
    ["site-create", { siteId: "../../etc", domain: "site.jgw.test" }],
    ["site-create", { siteId, domain: "x;root /;.jgw.test" }],
    ["site-create", { siteId, domain: "site.jgw.test", config: "server{}" }],
    ["account-create", { siteId, account: "root", password: "abcdefghijkl" }],
    [
      "account-create",
      { siteId, account: "jw-test", password: "password\nroot:replacement" },
    ],
  ])
    assert.throws(() => validateRequest(command, body));
  assert.doesNotThrow(() =>
    validateRequest("account-create", {
      siteId,
      account: "jw-test",
      password: "literal-$(touch-pwned)",
    }),
  );
  assert.throws(() =>
    renderSite({ siteId, domain: "site.jgw.test;include /etc/*;" }),
  );
  assert.throws(() =>
    validateRequest("content-deploy", {
      siteId,
      revision: 0,
      html: "<!doctype html>\n<!-- j-web-managed-template:v1 revision:0 -->\n",
    }),
  );
  assert.throws(() =>
    validateRequest("content-deploy", {
      siteId,
      revision: 1,
      html: "<!doctype html><script>arbitrary</script>",
    }),
  );
  assert.doesNotThrow(() =>
    validateRequest("content-deploy", {
      siteId,
      revision: 1,
      html: "<!doctype html>\n<!-- j-web-managed-template:v1 revision:1 -->\n<html></html>",
    }),
  );
});
