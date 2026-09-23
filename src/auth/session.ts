import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { config } from '../config';

/**
 * Signing in, done at Keycloak rather than here.
 *
 * Authorization code with PKCE, and no password ever reaches this application.
 * That is deliberate and it is the main security decision in this repository:
 * the console is the surface whose holder can raise the float, so its sign-in
 * should be Keycloak's to harden — single sign-on, a second factor, a session
 * policy, a lockout — and none of that is possible if the password is typed
 * into a form we wrote. The mobile app uses a direct grant because a customer
 * signing into a phone through a browser redirect is a worse experience for a
 * much smaller stake; the trade is not the same one.
 *
 * The token lives in memory and in `sessionStorage`, never in
 * `localStorage`. A treasury token in `localStorage` outlives the tab, is
 * shared by every tab, and is readable by anything that ever manages to run a
 * script on this origin. `sessionStorage` is what makes closing the tab mean
 * something.
 */
export const userManager = new UserManager({
  authority: config.oidc.authority,
  client_id: config.oidc.clientId,
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid profile email',

  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),

  // Renew in the background, a minute before the token dies. The alternative
  // is a treasurer typing a credit into a form and being thrown out on submit.
  automaticSilentRenew: true,
  accessTokenExpiringNotificationTimeInSeconds: 60,

  // Nothing here needs the user endpoint: the name and the roles are in the
  // token already, and a second round trip on every sign-in buys nothing.
  loadUserInfo: false,
});

/** Who is signed in, as this application needs them. */
export interface Operator {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly accessToken: string;
  readonly expiresAt: number | undefined;
}

export function toOperator(user: User): Operator {
  const claims = user.profile as Record<string, unknown>;

  return {
    id: user.profile.sub,
    name: (claims['name'] as string | undefined) ?? user.profile.sub,
    email: (claims['email'] as string | undefined) ?? '',
    roles: realmRoles(user),
    accessToken: user.access_token,
    expiresAt: user.expires_at,
  };
}

/**
 * The realm roles, read out of the access token.
 *
 * Keycloak puts them in a `realm_access` claim on the *access* token, not the
 * id token, and `oidc-client-ts` only parses the latter. So the access token
 * is decoded here — which is safe precisely because nothing is trusted from
 * it: the server checks the role on every request, and this reading exists
 * only to decide what to show. A console that hid the credit form from
 * somebody who could use it would be annoying; one that showed it to somebody
 * who could not would be worse, and both are cosmetic.
 */
function realmRoles(user: User): readonly string[] {
  const payload = decodeJwtPayload(user.access_token);
  if (!payload) return [];

  const access = payload['realm_access'];
  if (typeof access !== 'object' || access === null) return [];

  const roles = (access as { roles?: unknown }).roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const body = token.split('.')[1];
  if (!body) return null;

  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    // A JWT's payload is UTF-8 and `atob` gives bytes, so a name with an
    // accent in it — which in Cuba is most of them — needs decoding rather
    // than reading straight.
    const text = new TextDecoder().decode(
      Uint8Array.from(json, (character) => character.charCodeAt(0)),
    );
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
