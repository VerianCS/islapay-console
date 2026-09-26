import { createContext, use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createApi, unwrap } from '../api/client';
import type { components } from '../api/schema';
import { Session } from './session';
import type { Ended, Operator, TokenSource } from './session';

/** What the signed-in person may do, as the server works it out. */
export type StaffAccess = components['schemas']['StaffAccess'];

/**
 * The permissions the API checks, by name. The same strings as the server's
 * `Permissions` class: a route asks for one, and so does a button here.
 */
export const Can = {
  supportRead: 'support.read',
  p2pRead: 'p2p.read',
  p2pSettle: 'p2p.settle',
  p2pManage: 'p2p.manage',
  treasuryRead: 'treasury.read',
  treasuryPropose: 'treasury.propose',
  treasuryApprove: 'treasury.approve',
  catalogManage: 'catalog.manage',
  complianceRead: 'compliance.read',
  complianceAct: 'compliance.act',
  auditRead: 'audit.read',
  notificationsSend: 'notifications.send',
} as const;

export type Permission = (typeof Can)[keyof typeof Can];

export interface AuthState {
  readonly operator: Operator | null;
  /**
   * What the operator may do; null until the server has said. Read from
   * `/v1/me/permissions` rather than worked out from the token's roles, so the
   * table that decides it lives in one place and the console cannot disagree
   * with the API about it.
   */
  readonly access?: StaffAccess | null;
  /** True until the tab has found out whether it still has a session. */
  readonly loading: boolean;
  /** Why the last session ended on its own, if it did. */
  readonly ended: Ended;
  readonly signIn: (email: string, password: string, code?: string) => Promise<void>;
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
  const [access, setAccess] = useState<StaffAccess | null>(null);
  const operatorId = snapshot?.id ?? null;

  // Asked again whenever the person changes, and only then: roles live in the
  // token, so a refresh can change them, but a sign-out and back in is how a
  // grant reaches somebody anyway.
  useEffect(() => {
    if (operatorId === null) {
      setAccess(null);
      return;
    }

    let live = true;
    unwrap(createApi(session).GET('/v1/me/permissions', {}))
      .then((found) => {
        if (live) setAccess(found);
      })
      .catch(() => {
        // Nothing, rather than a guess: every route checks for itself, and a
        // console that cannot say what is allowed shows the screen that says so.
        if (live) setAccess({ roles: [], permissions: [], conflicts: [], multiFactorRequired: false });
      });

    return () => {
      live = false;
    };
  }, [operatorId, session]);

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
      access,
      loading: loading || (snapshot !== null && access === null),
      ended,
      signIn: (email, password, code) => session.signIn(email, password, code),
      signOut: () => session.signOut(),
      session,
    }),
    [snapshot, access, loading, ended, session],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth fuera de AuthProvider.');
  return value;
}

/** Whether the signed-in operator holds a permission. */
export function useCan(permission: Permission): boolean {
  const { access } = useAuth();
  return access?.permissions.includes(permission) ?? false;
}
