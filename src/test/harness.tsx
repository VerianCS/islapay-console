import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthContext } from '../auth/AuthProvider';
import type { AuthState } from '../auth/AuthProvider';

/**
 * A signed-in treasurer, without a Keycloak.
 *
 * What these tests are about is what the screens do with a session, and a
 * session is four fields. Redirecting to an identity provider in a test would
 * be testing `oidc-client-ts`, which is not this repository's code.
 */
export function signedIn(roles: readonly string[] = ['treasury-admin']): AuthState {
  return {
    operator: {
      id: 'op-1',
      name: 'Ana Pérez',
      email: 'ana@islapay.cu',
      roles,
      accessToken: 'test-token',
      expiresAt: undefined,
    },
    loading: false,
    error: null,
    signIn: async () => {},
    signOut: async () => {},
    token: () => 'test-token',
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
