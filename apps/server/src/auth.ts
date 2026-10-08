import {
  createTokenVerifier,
  TokenVerificationError,
} from "@j-auth/token-verifier";
import type { TokenVerifier } from "@j-auth/token-verifier";
import type { FastifyRequest } from "fastify";
import { ApiError, forbidden, unavailable } from "./errors.js";
export function memberGate(options: {
  tenant: string;
  keycloakOrigin: string;
  fetch?: typeof globalThis.fetch;
  verifier?: TokenVerifier;
}) {
  const verifier =
    options.verifier ??
    createTokenVerifier({
      publicUrl: options.keycloakOrigin,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  return async (request: FastifyRequest, role: string) => {
    const auth = request.headers.authorization;
    if (
      !auth ||
      !/^Bearer [^\s]+$/.test(auth) ||
      auth.length > 16400 ||
      request.headers.cookie !== undefined
    )
      throw new ApiError(401, "unauthenticated", "Valid bearer required.");
    try {
      const identity = await verifier.verify(auth.slice(7), {
          tenantId: options.tenant,
          audience: "j-web",
        }),
        aud = identity.claims.aud;
      if (
        !(
          aud === "j-web" ||
          (Array.isArray(aud) && aud.length === 1 && aud[0] === "j-web")
        ) ||
        typeof identity.claims.sid !== "string" ||
        !identity.claims.sid ||
        typeof identity.claims.preferred_username !== "string" ||
        !identity.claims.preferred_username ||
        identity.claims.preferred_username.startsWith("service-account-")
      )
        throw new ApiError(401, "unauthenticated", "Invalid bearer identity.");
      if (!identity.roles.includes(role)) throw forbidden();
      return identity;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof TokenVerificationError && e.kind === "invalid")
        throw new ApiError(401, "unauthenticated", "Invalid bearer identity.");
      throw unavailable();
    }
  };
}
