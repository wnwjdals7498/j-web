import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolConfig } from "pg";
import { assertCustomerTenantId } from "@j-auth/contracts";
import { isIP } from "node:net";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.startsWith("__PLACEHOLDER_"))
    throw new Error("Set external web configuration.");
  return value;
}
export function port(value: string): number {
  const parsed = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || parsed > 65535 || parsed === 3001)
    throw new Error("Invalid or reserved port.");
  return parsed;
}
export function externalFile(value: string): string {
  if (
    !path.isAbsolute(value) ||
    !path.relative(repository, value).startsWith(".." + path.sep)
  )
    throw new Error("Require a file outside checkout.");
  return value;
}
export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  if (
    (env.JW_DB_NAME && env.JW_DB_NAME !== "jgw_web") ||
    (env.JW_DB_USER && env.JW_DB_USER !== "jgw_web")
  )
    throw new Error("Require dedicated jgw_web database and non-superuser.");
  return {
    host: env.JW_DB_HOST ?? "127.0.0.1",
    port: port(env.JW_DB_PORT ?? "55046"),
    database: "jgw_web",
    user: "jgw_web",
    password: required(env, "JW_DB_PASSWORD"),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    application_name: "j-web",
  };
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const tenant = required(env, "JW_TENANT");
  assertCustomerTenantId(tenant);
  const issuer = new URL(required(env, "KC_PUBLIC_URL"));
  if (
    issuer.protocol !== "https:" ||
    !issuer.hostname.endsWith(".jgw.test") ||
    issuer.port === "3001" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.pathname !== "/"
  )
    throw new Error("Require registered Keycloak HTTPS origin.");
  if (env.JW_CUSTOMER_ADDRESS && isIP(env.JW_CUSTOMER_ADDRESS) !== 4)
    throw new Error("Require a customer IPv4 address for DNS A guidance.");
  return {
    tenant,
    keycloakOrigin: issuer.origin,
    port: port(env.JW_PORT ?? "55047"),
    tlsCertificate: externalFile(required(env, "JW_TLS_CERTIFICATE")),
    tlsKey: externalFile(required(env, "JW_TLS_KEY")),
    database: loadDatabaseConfig(env),
    customerAddress: env.JW_CUSTOMER_ADDRESS,
  };
}
