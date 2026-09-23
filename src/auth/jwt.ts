/**
 * The payload of a JWT, read and not verified.
 *
 * Safe here precisely because nothing is trusted from it: the server checks
 * the signature and the role on every request, and this reading only decides
 * what to show. A console that hid the credit form from somebody who could use
 * it would be annoying; one that showed it to somebody who could not would be
 * a dead end — and both are cosmetic.
 */
export function readClaims(token: string): Record<string, unknown> | null {
  const body = token.split('.')[1];
  if (!body) return null;

  try {
    const binary = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    // A JWT's payload is UTF-8 and `atob` gives bytes, so a name with an
    // accent in it — which in Cuba is most of them — needs decoding rather
    // than reading straight.
    const text = new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
    const claims: unknown = JSON.parse(text);
    return typeof claims === 'object' && claims !== null
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The realm roles Keycloak puts in `realm_access`. */
export function realmRoles(claims: Record<string, unknown>): readonly string[] {
  const access = claims['realm_access'];
  if (typeof access !== 'object' || access === null) return [];

  const roles = (access as { roles?: unknown }).roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
}
