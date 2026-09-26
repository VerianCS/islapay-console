import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Money } from '../money/money';
import type { Currency, CurrencyScales } from '../money/money';
import { createApi, newIdempotencyKey, unwrap } from './client';
import type { components } from './schema';

type Schema<K extends keyof components['schemas']> = components['schemas'][K];

export type CurrencyDto = Schema<'CurrencyDto'>;
export type NetworkDto = Schema<'NetworkDto'>;
export type CurrencyInfo = Schema<'CurrencyInfo'>;
export type TreasuryBalances = Schema<'TreasuryBalancesDto'>;
export type TreasuryAccount = Schema<'TreasuryAccountDto'>;
export type Reconciliation = Schema<'TreasuryReconciliationDto'>;
export type EscrowRow = Schema<'EscrowReconciliationDto'>;
export type CreditRequest = Schema<'CreditRequest'>;
export type TreasuryProposal = Schema<'TreasuryProposalDto'>;
export type Issuance = Schema<'IssuanceDto'>;
export type IssuanceRequest = Schema<'IssuanceRequest'>;
export type AuditEntry = Schema<'AuditEntryDto'>;
export type AuditPage = Schema<'CursorPageOfAuditEntryDto'>;
export type AccountStanding = Schema<'AccountStandingDto'>;
export type LedgerEntryPage = Schema<'LedgerEntryPage'>;
export type P2PQueueItem = Schema<'P2PQueueItemDto'>;
export type P2PTrade = Schema<'P2PTradeDto'>;
export type P2PAdminMethod = Schema<'P2PAdminMethodDto'>;
export type P2PMethodRate = Schema<'P2PMethodRateDto'>;
export type P2PMethodCreate = Schema<'P2PMethodCreate'>;
export type P2PMethodUpdate = Schema<'P2PMethodUpdate'>;
export type P2PRateUpdate = Schema<'P2PRateUpdate'>;
export type P2PSide = Schema<'P2PSide'>;
export type NotificationItem = Schema<'NotificationDto'>;
export type NotificationPage = Schema<'NotificationPageDto'>;
export type Broadcast = Schema<'BroadcastDto'>;
export type BroadcastRequest = Schema<'BroadcastRequest'>;

/** The client, rebuilt only when the session object itself changes. */
function useApi() {
  const { session } = useAuth();
  return useMemo(() => createApi(session), [session]);
}

/**
 * The currency catalogue, and the scales everything else is rendered with.
 *
 * `all=true`, so a currency that has been switched off is still here. Escrow
 * can hold money in a currency somebody has just disabled, and a console that
 * could not render that balance would hide it at the exact moment it matters.
 *
 * Long-lived in the cache because it is the one thing every other screen waits
 * for: a table that changes when somebody flips a switch, not on a timer.
 */
export function useCatalogue(): UseQueryResult<readonly CurrencyDto[]> {
  const api = useApi();

  return useQuery({
    queryKey: ['catalogue', 'currencies'],
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      unwrap(api.GET('/v1/catalog/currencies', { params: { query: { all: true } } })),
  });
}

export function useNetworks(): UseQueryResult<readonly NetworkDto[]> {
  const api = useApi();

  return useQuery({
    queryKey: ['catalogue', 'networks'],
    staleTime: 5 * 60 * 1000,
    queryFn: () => unwrap(api.GET('/v1/catalog/networks', {})),
  });
}

/** Every currency the table holds, switched on or not. Needs `catalog-admin`. */
export function useAdminCurrencies(): UseQueryResult<readonly CurrencyInfo[]> {
  const api = useApi();

  return useQuery({
    queryKey: ['catalogue', 'admin', 'currencies'],
    queryFn: () => unwrap(api.GET('/v1/admin/catalog/currencies', {})),
  });
}

export function useSetCurrencyEnabled(): UseMutationResult<
  void,
  Error,
  { code: string; value: boolean }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: async ({ code, value }) => {
      await unwrap(
        api.PUT('/v1/admin/catalog/currencies/{code}/enabled', {
          params: { path: { code }, query: { value } },
        }) as Promise<{ data?: void; error?: unknown; response: Response }>,
      );
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ['catalogue'] }),
  });
}

export function useSetNetworkEnabled(): UseMutationResult<
  void,
  Error,
  { id: string; value: boolean }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, value }) => {
      await unwrap(
        api.PUT('/v1/admin/catalog/networks/{id}/enabled', {
          params: { path: { id }, query: { value } },
        }) as Promise<{ data?: void; error?: unknown; response: Response }>,
      );
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ['catalogue'] }),
  });
}

/**
 * Where the platform's money is.
 *
 * Refetched when the window regains focus. A treasurer leaves this open on a
 * second screen, and a figure that is twenty minutes stale is worse than no
 * figure: it is a number they will act on.
 */
export function useBalances(): UseQueryResult<TreasuryBalances> {
  const api = useApi();

  return useQuery({
    queryKey: ['treasury', 'balances'],
    refetchOnWindowFocus: true,
    queryFn: () => unwrap(api.GET('/v1/admin/treasury/balances', {})),
  });
}

/**
 * Escrow, as the ledger has it against what the modules say it should be.
 *
 * Refetched every half minute while the page is open, because an in-flight
 * posting resolves on its own and the interesting question — is this still
 * disagreeing? — cannot be answered by one reading.
 */
export function useReconciliation(): UseQueryResult<Reconciliation> {
  const api = useApi();

  return useQuery({
    queryKey: ['treasury', 'reconciliation'],
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: () => unwrap(api.GET('/v1/admin/treasury/reconciliation', {})),
  });
}

export function useAccountEntries(
  owner: string | null,
  currency: string | null,
): UseQueryResult<LedgerEntryPage> {
  const api = useApi();

  return useQuery({
    queryKey: ['treasury', 'entries', owner, currency],
    enabled: owner !== null && currency !== null,
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/treasury/accounts/{owner}/{currency}/entries', {
          params: { path: { owner: owner!, currency: currency! }, query: { limit: 50 } },
        }),
      ),
  });
}

/**
 * Asks for money to be put in. Moves nothing: somebody else approves it.
 *
 * The idempotency key is minted here, once per call, and deliberately not
 * derived from the amount and the destination: two intentional credits of the
 * same amount to the same place are two proposals, and a key that collapsed
 * them would silently discard the second. What the key protects against is the
 * same press arriving twice.
 */
export function useProposeCredit(): UseMutationResult<TreasuryProposal, Error, CreditRequest> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: (body) =>
      unwrap(
        api.POST('/v1/admin/treasury/credits', {
          body,
          headers: { 'Idempotency-Key': newIdempotencyKey() },
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['treasury'] }),
  });
}

/** How much E-ISLA exists, and what backs it. */
export function useIssuance(): UseQueryResult<Issuance> {
  const api = useApi();

  return useQuery({
    queryKey: ['treasury', 'issuance'],
    refetchOnWindowFocus: true,
    queryFn: () => unwrap(api.GET('/v1/admin/treasury/issuance', {})),
  });
}

/** Proposes a mint or a burn. Moves nothing until somebody else approves. */
export function useProposeIssuance(): UseMutationResult<
  TreasuryProposal,
  Error,
  { kind: 'mint' | 'burn'; body: IssuanceRequest }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: ({ kind, body }) =>
      unwrap(
        kind === 'mint'
          ? api.POST('/v1/admin/treasury/mints', {
              body,
              headers: { 'Idempotency-Key': newIdempotencyKey() },
            })
          : api.POST('/v1/admin/treasury/burns', {
              body,
              headers: { 'Idempotency-Key': newIdempotencyKey() },
            }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['treasury'] }),
  });
}

/** Proposals, newest first; `pending` for the approvals inbox. */
export function useProposals(status: string | null): UseQueryResult<readonly TreasuryProposal[]> {
  const api = useApi();

  return useQuery({
    queryKey: ['treasury', 'proposals', status],
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/treasury/proposals', {
          params: { query: { ...(status ? { status } : {}), limit: 100 } },
        }),
      ),
  });
}

/**
 * Approves, rejects or withdraws a proposal.
 *
 * The key comes from the dialog, minted when it opens: approving twice after a
 * timeout is the same approval, and the server answers the second with the
 * first rather than posting the money again.
 */
export function useDecideProposal(): UseMutationResult<
  TreasuryProposal,
  Error,
  { id: string; verdict: 'approve' | 'reject' | 'withdraw'; note?: string; key: string }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: ({ id, verdict, note, key }) => {
      const path = { params: { path: { id } } };
      switch (verdict) {
        case 'approve':
          return unwrap(
            api.POST('/v1/admin/treasury/proposals/{id}/approve', {
              ...path,
              body: { note: note ?? null },
              headers: { 'Idempotency-Key': key },
            }),
          );
        case 'reject':
          return unwrap(
            api.POST('/v1/admin/treasury/proposals/{id}/reject', {
              ...path,
              body: { note: note ?? null },
            }),
          );
        case 'withdraw':
          return unwrap(api.POST('/v1/admin/treasury/proposals/{id}/withdraw', path));
      }
    },
    onSettled: () => cache.invalidateQueries({ queryKey: ['treasury'] }),
  });
}

// ------------------------------------------------------------------ audit

/** One page of the audit log, newest first. */
export function useAudit(
  actor: string,
  action: string,
  cursor: string | null,
): UseQueryResult<AuditPage> {
  const api = useApi();

  return useQuery({
    queryKey: ['audit', actor, action, cursor],
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/audit', {
          params: {
            query: {
              ...(actor.trim() !== '' ? { actor: actor.trim() } : {}),
              ...(action.trim() !== '' ? { action: action.trim() } : {}),
              ...(cursor ? { cursor } : {}),
              limit: 50,
            },
          },
        }),
      ),
  });
}

// ------------------------------------------------------------------ compliance

/** An account by the address the person gives on the phone. */
export function useAccountLookup(email: string): UseQueryResult<AccountStanding> {
  const api = useApi();
  const address = email.trim().toLowerCase();

  return useQuery({
    queryKey: ['compliance', 'account', address],
    enabled: address !== '',
    queryFn: () =>
      unwrap(api.GET('/v1/admin/compliance/accounts', { params: { query: { email: address } } })),
  });
}

/** Freezes, unfreezes or sets the level of an account. Always with a reason. */
export function useChangeStanding(): UseMutationResult<
  AccountStanding,
  Error,
  | { id: string; change: 'freeze' | 'unfreeze'; reason: string }
  | { id: string; change: 'level'; level: number; reason: string }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: (request) => {
      const path = { params: { path: { id: request.id } } };
      switch (request.change) {
        case 'freeze':
          return unwrap(
            api.POST('/v1/admin/compliance/accounts/{id}/freeze', {
              ...path,
              body: { reason: request.reason },
            }),
          );
        case 'unfreeze':
          return unwrap(
            api.POST('/v1/admin/compliance/accounts/{id}/unfreeze', {
              ...path,
              body: { reason: request.reason },
            }),
          );
        case 'level':
          return unwrap(
            api.PUT('/v1/admin/compliance/accounts/{id}/level', {
              ...path,
              body: { level: request.level, reason: request.reason },
            }),
          );
      }
    },
    onSuccess: (after) =>
      cache.setQueryData(['compliance', 'account', after.email.toLowerCase()], after),
  });
}

// ------------------------------------------------------------------ P2P desk

type Void = Promise<{ data?: void; error?: unknown; response: Response }>;

/**
 * What waits on a person, oldest first.
 *
 * Polled every fifteen seconds while the page is open. The queue is the
 * operator's whole job, and a sale that appeared a minute ago and is not on
 * screen is a customer waiting for pesos nobody knows they are owed.
 */
export function useP2PQueue(): UseQueryResult<readonly P2PQueueItem[]> {
  const api = useApi();

  return useQuery({
    queryKey: ['p2p', 'queue'],
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () => unwrap(api.GET('/v1/admin/p2p/queue', { params: { query: { limit: 200 } } })),
  });
}

/**
 * Everything the queue does not show, found by reference or status.
 *
 * Only asked once there is something to ask with: an empty search would be
 * the whole history, newest first, which is nobody's question.
 */
export function useP2PSearch(
  reference: string,
  status: string,
): UseQueryResult<readonly P2PQueueItem[]> {
  const api = useApi();
  const ref = reference.trim();

  return useQuery({
    queryKey: ['p2p', 'search', ref, status],
    enabled: ref !== '' || status !== '',
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/p2p/trades', {
          params: {
            query: {
              ...(ref !== '' ? { reference: ref } : {}),
              ...(status !== '' ? { status } : {}),
              limit: 100,
            },
          },
        }),
      ),
  });
}

/**
 * Settles one leg: a sale paid out, or a purchase's pesos received.
 *
 * The key comes from the dialog, minted when it opens. Pressing again after a
 * timeout is the same settlement asked twice, and the server answers the
 * second with the first — which is the whole point: sending somebody pesos
 * twice is the failure this desk exists to not make.
 */
export function useSettleTrade(): UseMutationResult<
  P2PTrade,
  Error,
  { id: string; action: 'paid' | 'received'; reference: string; key: string }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: ({ id, action, reference, key }) =>
      unwrap(
        action === 'paid'
          ? api.POST('/v1/admin/p2p/trades/{id}/paid', {
              params: { path: { id } },
              body: { reference },
              headers: { 'Idempotency-Key': key },
            })
          : api.POST('/v1/admin/p2p/trades/{id}/received', {
              params: { path: { id } },
              body: { reference },
              headers: { 'Idempotency-Key': key },
            }),
      ),
    onSettled: () => cache.invalidateQueries({ queryKey: ['p2p'] }),
  });
}

/** A sale that could not be paid: the money goes back, with the reason shown to the customer. */
export function useFailTrade(): UseMutationResult<
  P2PTrade,
  Error,
  { id: string; reason: string; key: string }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason, key }) =>
      unwrap(
        api.POST('/v1/admin/p2p/trades/{id}/failed', {
          params: { path: { id } },
          body: { reason },
          headers: { 'Idempotency-Key': key },
        }),
      ),
    onSettled: () => cache.invalidateQueries({ queryKey: ['p2p'] }),
  });
}

/** Every rail as the desk edits it, switched off ones included. */
export function useP2PMethods(): UseQueryResult<readonly P2PAdminMethod[]> {
  const api = useApi();

  return useQuery({
    queryKey: ['p2p', 'methods'],
    queryFn: () => unwrap(api.GET('/v1/admin/p2p/methods', {})),
  });
}

/** Publishes a price, or withdraws one with a null rate. Appends; never edits. */
export function useSetP2PRate(): UseMutationResult<void, Error, P2PRateUpdate> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: async (body) => {
      await unwrap(api.PUT('/v1/admin/p2p/rates', { body }) as Void);
    },
    onSettled: () => cache.invalidateQueries({ queryKey: ['p2p', 'methods'] }),
  });
}

export function useSetP2PAvailable(): UseMutationResult<void, Error, { id: string; value: boolean }> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, value }) => {
      await unwrap(
        api.PUT('/v1/admin/p2p/methods/{id}/available', {
          params: { path: { id }, query: { value } },
        }) as Void,
      );
    },
    onSettled: () => cache.invalidateQueries({ queryKey: ['p2p', 'methods'] }),
  });
}

export function useSetP2PInstructions(): UseMutationResult<
  void,
  Error,
  { id: string; instructions: string }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, instructions }) => {
      await unwrap(
        api.PUT('/v1/admin/p2p/methods/{id}/instructions', {
          params: { path: { id } },
          body: { instructions },
        }) as Void,
      );
    },
    onSettled: () => cache.invalidateQueries({ queryKey: ['p2p', 'methods'] }),
  });
}

export function useCreateP2PMethod(): UseMutationResult<P2PAdminMethod, Error, P2PMethodCreate> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: (body) => unwrap(api.POST('/v1/admin/p2p/methods', { body })),
    onSettled: () => cache.invalidateQueries({ queryKey: ['p2p', 'methods'] }),
  });
}

export function useUpdateP2PMethod(): UseMutationResult<
  P2PAdminMethod,
  Error,
  { id: string; update: P2PMethodUpdate }
> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: ({ id, update }) =>
      unwrap(api.PATCH('/v1/admin/p2p/methods/{id}', { params: { path: { id } }, body: update })),
    onSettled: () => cache.invalidateQueries({ queryKey: ['p2p', 'methods'] }),
  });
}

/**
 * The catalogue as something that can render an amount.
 *
 * Every screen that shows money needs this and none of them should build it,
 * so it is derived from the one query that already holds the table.
 */
export function useScales(): CurrencyScales & {
  readonly ready: boolean;
  readonly error: unknown;
} {
  const { data, error } = useCatalogue();

  return useMemo(() => {
    const byCode = new Map<string, Currency>(
      (data ?? []).map((c) => [c.code, { code: c.code, scale: c.scale }]),
    );

    return {
      ready: data !== undefined,
      // Carried out, not swallowed. Every screen that shows money waits for
      // this, so a catalogue that fails and says nothing leaves all of them
      // spinning for ever — which is how a 401 spent an afternoon looking
      // like a slow server.
      error,
      find: (code: string) => byCode.get(code),
    };
  }, [data, error]);
}

/** Reads a wire amount, or gives up rather than guessing a scale. */
export function readMoney(
  wire: components['schemas']['Money'],
  scales: CurrencyScales,
): Money | null {
  try {
    return Money.parse(wire, scales);
  } catch {
    return null;
  }
}

/** Announcements sent, newest first — to everybody and to one account alike. */
export function useBroadcasts(): UseQueryResult<readonly Broadcast[]> {
  const api = useApi();

  return useQuery({
    queryKey: ['notifications', 'broadcasts'],
    queryFn: () => unwrap(api.GET('/v1/admin/notifications/broadcasts', { params: { query: { limit: 50 } } })),
  });
}

/**
 * Sends an announcement.
 *
 * A fresh key per press, like a credit: the key protects against one press
 * arriving twice, not against somebody sending the same words again on
 * purpose next week.
 */
export function useSendBroadcast(): UseMutationResult<Broadcast, Error, BroadcastRequest> {
  const api = useApi();
  const cache = useQueryClient();

  return useMutation({
    mutationFn: (body) =>
      unwrap(
        api.POST('/v1/admin/notifications/broadcasts', {
          body,
          headers: { 'Idempotency-Key': newIdempotencyKey() },
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/** What one customer was told, for the call that begins «nunca me avisaron». */
export function useUserNotifications(userId: string | null): UseQueryResult<NotificationPage> {
  const api = useApi();

  return useQuery({
    queryKey: ['notifications', 'user', userId],
    enabled: userId !== null,
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/notifications/users/{userId}', {
          params: { path: { userId: userId! }, query: { limit: 20 } },
        }),
      ),
  });
}
