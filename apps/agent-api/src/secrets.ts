/**
 * Resolve a tenant bearer token from its secret reference (ADR-0004), mirroring the
 * worker: a tenant's `tokenRef` is the NAME of an environment variable holding the
 * `malu_` token, so raw tokens never live in the operational DB or in code.
 */
export function resolveToken(tokenRef: string, env: NodeJS.ProcessEnv = process.env): string {
  const token = env[tokenRef];
  if (!token) {
    throw new Error(`tenant token not found for secret ref "${tokenRef}" (set env var ${tokenRef})`);
  }
  return token;
}
