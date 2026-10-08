import { describe, it, expect } from "vitest";
import {
  loadDatabaseConfig,
  externalFile,
  port,
} from "../../apps/server/src/config.js";
describe("dedicated external configuration", () => {
  it("keeps the dedicated non-superuser identity and rejects secret paths/reserved ports", () => {
    expect(loadDatabaseConfig({ JW_DB_PASSWORD: "fixture" })).toMatchObject({
      database: "jgw_web",
      user: "jgw_web",
    });
    for (const env of [
      { JW_DB_PASSWORD: "__PLACEHOLDER_PASSWORD" },
      { JW_DB_PASSWORD: "fixture", JW_DB_USER: "postgres" },
      { JW_DB_PASSWORD: "fixture", JW_DB_NAME: "other" },
    ])
      expect(() => loadDatabaseConfig(env)).toThrow();
    for (const value of ["3001", "0", "01", "65536"])
      expect(() => port(value)).toThrow();
    expect(() => externalFile("/workspace/j-web/secret.key")).toThrow();
  });
});
