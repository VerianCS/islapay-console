import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * The server, stubbed at the network rather than at a module.
 *
 * MSW intercepts `fetch`, so everything under test is the real thing: the
 * generated client, the header it sets, the unwrapping, the problem
 * translation. Stubbing a repository instead would prove the screens render
 * and prove nothing about whether they can talk to the API — which is exactly
 * the gap that let a wire bug reach the mobile app's users.
 */
export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Relative, so a handler matches whatever origin jsdom is serving from. The
// client's base is empty too — every request in this console is relative.
export const API = '';

/** The catalogue every screen waits for before it renders an amount. */
export function catalogue() {
  return http.get(`${API}/v1/catalog/currencies`, () =>
    HttpResponse.json([
      {
        code: 'EISLA',
        name: 'Moneda IslaPay',
        scale: 2,
        kind: 'internal',
        symbol: 'E$',
        customerHoldable: true,
        enabled: true,
      },
      {
        code: 'USDT',
        name: 'Tether',
        scale: 6,
        kind: 'stablecoin',
        symbol: '₮',
        customerHoldable: true,
        enabled: true,
      },
    ]),
  );
}

/** A refusal in the shape the platform really writes. */
export function problem(status: number, code: string, detail?: string) {
  return HttpResponse.json(
    {
      code,
      title: 'Error',
      status,
      detail: detail ?? null,
      type: `https://docs.islapay.cu/errors/${code}`,
      instance: null,
      correlationId: 'abc123',
      meta: null,
    },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}
