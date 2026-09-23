import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'oidc-client-ts';
import { config } from '../config';
import { toOperator, userManager } from './session';
import type { Operator } from './session';

export interface AuthState {
  readonly operator: Operator | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly signIn: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  /** The freshest access token, for the API client. */
  readonly token: () => string | undefined;
}

/**
 * Exported so a test can supply a session without a Keycloak.
 *
 * The alternative is a test that redirects to an identity provider, which is
 * not a test of anything this repository owns. What is under test here is what
 * the screens do with a session, and a session is four fields.
 */
export const AuthContext = createContext<AuthState | null>(null);


/**
 * Holds the session, and keeps the token the API client reads current.
 *
 * The token is kept in a ref as well as in state. State is what re-renders the
 * screen; the ref is what a request reads, and the two exist separately
 * because a fetch started between a silent renewal and the next render would
 * otherwise send the token that had just been replaced.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | undefined>(undefined);

  const adopt = useCallback((user: User | null) => {
    if (!user || user.expired) {
      token.current = undefined;
      setOperator(null);
      return;
    }

    const next = toOperator(user);
    token.current = next.accessToken;
    setOperator(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        // Coming back from Keycloak. The code and state are in the URL and
        // must be exchanged before anything else looks at the address bar.
        if (window.location.pathname === '/callback') {
          const user = await userManager.signinCallback();
          if (!cancelled) adopt(user ?? null);
          // Replaced rather than pushed: the authorization code is in that
          // URL, and leaving it in history means it is in the browser's
          // address bar, its history file, and anything that syncs either.
          window.history.replaceState({}, '', '/');
          return;
        }

        const user = await userManager.getUser();
        if (!cancelled) adopt(user);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'No se pudo restaurar la sesión.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void restore();

    const onLoaded = (user: User) => adopt(user);
    const onUnloaded = () => adopt(null);
    // A silent renewal that fails means the session at Keycloak is gone —
    // revoked, expired, signed out in another tab. Dropping the operator here
    // sends them back to the sign-in screen instead of letting every request
    // answer 401 one by one.
    const onSilentRenewError = () => adopt(null);

    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onUnloaded);
    userManager.events.addSilentRenewError(onSilentRenewError);

    return () => {
      cancelled = true;
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onUnloaded);
      userManager.events.removeSilentRenewError(onSilentRenewError);
    };
  }, [adopt]);

  const value = useMemo<AuthState>(
    () => ({
      operator,
      loading,
      error,
      signIn: () => userManager.signinRedirect(),
      signOut: async () => {
        adopt(null);
        await userManager.signoutRedirect();
      },
      token: () => token.current,
    }),
    [operator, loading, error, adopt],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth fuera de AuthProvider.');
  return value;
}

/** Whether the signed-in operator may use this console at all. */
export function useIsTreasuryAdmin(): boolean {
  const { operator } = useAuth();
  return operator?.roles.includes(config.role) ?? false;
}
