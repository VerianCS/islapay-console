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
export type CreditReceipt = Schema<'CreditReceiptDto'>;
export type LedgerEntryPage = Schema<'LedgerEntryPage'>;

/** The client, rebuilt only when the session changes. */
function useApi() {
  const { token } = useAuth();
  return useMemo(() => createApi(token), [token]);
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
 * Puts money in.
 *
 * The idempotency key is minted here, once per call, and deliberately not
 * derived from the amount and the destination: two intentional credits of the
 * same amount to the same place are two credits, and a key that collapsed them
 * would silently discard the second. What the key protects against is the same
 * press arriving twice.
 */
export function useCredit(): UseMutationResult<CreditReceipt, Error, CreditRequest> {
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

/**
 * The catalogue as something that can render an amount.
 *
 * Every screen that shows money needs this and none of them should build it,
 * so it is derived from the one query that already holds the table.
 */
export function useScales(): CurrencyScales & { readonly ready: boolean } {
  const { data } = useCatalogue();

  return useMemo(() => {
    const byCode = new Map<string, Currency>(
      (data ?? []).map((c) => [c.code, { code: c.code, scale: c.scale }]),
    );

    return {
      ready: data !== undefined,
      find: (code: string) => byCode.get(code),
    };
  }, [data]);
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
