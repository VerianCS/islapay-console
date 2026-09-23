import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { config } from '../config';
import { Session } from './session';
import type { Ended, Operator, TokenSource } from './session';

export interface AuthState {
  readonly operator: Operator | null;
  /** True until the tab has found out whether it still has a session. */
  readonly loading: boolean;
  /** Why the last session ended on its own, if it did. */
  readonly ended: Ended;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  /** What the API client reads tokens from. */
  readonly session: TokenSource;
}

/**
 * Exported so a test can supply a session without a server.
 *
 * What the screens are tested for is what they do with a session, and a
 * session is a handful of fields.
 */
export const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds the one session this tab has.
 *
 * The session is an object outside React, and the provider subscribes to it
 * rather than copying it into state. A token refresh happens inside a request,
 * not inside a render, and a copy would always be one refresh behind.
 */
export function AuthProvider({ children, session: given }: { children: ReactNode; session?: Session }) {
  const [session] = useState(() => given ?? new Session());
  const [loading, setLoading] = useState(true);

  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.operator,
  );
  const ended = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.ended,
  );

  useEffect(() => {
    let live = true;

    // A reload, not a sign-in: the tab may still hold a refresh token. A
    // failure here is not shown — a network hiccup on load is better answered
    // by the sign-in form than by an error about a session nobody asked for.
    session
      .restore()
      .catch(() => false)
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [session]);

  const value = useMemo<AuthState>(
    () => ({
      operator: snapshot,
      loading,
      ended,
      signIn: (email, password) => session.signIn(email, password),
      signOut: () => session.signOut(),
      session,
    }),
    [snapshot, loading, ended, session],
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
