import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthContext } from '../auth/AuthProvider';
import type { AuthState, StaffAccess } from '../auth/AuthProvider';

/**
 * A signed-in member of staff, without a server.
 *
 * What these tests are about is what the screens do with a session and a set
 * of permissions. How the session itself signs in and refreshes is tested on
 * its own, in `session.test.ts`, against the same stubbed network; which
 * permissions a role gives is the server's table, tested there.
 *
 * By default a treasury operator: reads the funds and proposes credits.
 */
export function signedIn(
  permissions: readonly string[] = ['treasury.read', 'treasury.propose', 'catalog.manage'],
  extra: Partial<StaffAccess> = {},
): AuthState {
  return {
    operator: {
      id: 'op-1',
      name: 'Ana Pérez',
      email: 'ana@islapay.cu',
      roles: [],
    },
    access: {
      roles: [],
      permissions: [...permissions],
      conflicts: [],
      multiFactorRequired: false,
      ...extra,
    },
    loading: false,
    ended: null,
    signIn: async () => {},
    signOut: async () => {},
    session: {
      accessToken: async () => 'test-token',
      forceRefresh: async () => 'test-token',
    },
  };
}

export function renderWith(
  ui: ReactNode,
  auth: AuthState = signedIn(),
): RenderResult & { queries: QueryClient } {
  const queries = new QueryClient({
    defaultOptions: {
      // No retries and no cache between tests: a retried 403 makes a failing
      // assertion take four seconds to fail, and a shared cache makes the
      // second test depend on the first.
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return {
    ...render(
      <QueryClientProvider client={queries}>
        <AuthContext value={auth}>{ui}</AuthContext>
      </QueryClientProvider>,
    ),
    queries,
  };
}
