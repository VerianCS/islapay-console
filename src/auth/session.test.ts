import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, problem, server } from '../test/server';
import { createApi, unwrap } from '../api/client';
import { Session } from './session';

const PASSWORD = 'Correct-Horse-9';

/** A token with the claims Keycloak really puts in one. Unsigned: nothing here checks. */
function token(n: number, roles: readonly string[] = ['treasury-admin']): string {
  const payload = {
    sub: 'op-1',
    name: 'Ana Pérez',
    email: 'ana@islapay.cu',
    realm_access: { roles },
    n,
  };
  const encode = (value: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function pair(n: number, expiresIn = 60) {
  return {
    accessToken: token(n),
    refreshToken: `refresh-${n}`,
    expiresIn,
    refreshExpiresIn: 1800,
    tokenType: 'Bearer',
  };
}

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  values() {
    return [...this.items.values()];
  }
}

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function login(n = 1) {
  return http.post(`${API}/v1/auth/login`, () =>
    HttpResponse.json({
      tokens: pair(n),
      user: {
        id: 'op-1',
        name: 'Ana Pérez',
        email: 'ana@islapay.cu',
        phone: null,
        emailVerified: true,
        phoneVerified: false,
      },
    }),
  );
}

describe('La sesión', () => {
  it('signs in and reads who it is from the token', async () => {
    server.use(login());
    const session = new Session(undefined, new MemoryStorage());

    await session.signIn('ana@islapay.cu', PASSWORD);

    expect(session.operator).toEqual({
      id: 'op-1',
      name: 'Ana Pérez',
      email: 'ana@islapay.cu',
      roles: ['treasury-admin'],
    });
  });

  it('keeps the refresh token in the tab and the password nowhere', async () => {
    server.use(login());
    const storage = new MemoryStorage();
    const session = new Session(undefined, storage);

    await session.signIn('ana@islapay.cu', PASSWORD);

    // A reload needs the refresh token and nothing else. The password was a
    // parameter and went nowhere but the request body.
    expect(storage.values()).toEqual(['refresh-1']);
    expect(storage.values().join()).not.toContain(PASSWORD);
    // Nor is the access token written down: it lives in memory only.
    expect(storage.values().join()).not.toContain(token(1));
  });

  it('refuses in the server’s words, and signs nobody in', async () => {
    server.use(http.post(`${API}/v1/auth/login`, () => problem(401, 'invalid_credentials')));
    const session = new Session(undefined, new MemoryStorage());

    await expect(session.signIn('ana@islapay.cu', 'wrong')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(session.operator).toBeNull();
  });

  it('reuses a token while it is fresh and replaces it before it dies', async () => {
    let refreshes = 0;
    server.use(
      login(1),
      http.post(`${API}/v1/auth/token/refresh`, () => HttpResponse.json(pair(1 + ++refreshes))),
    );
    const time = clock();
    const session = new Session(undefined, new MemoryStorage(), time.now);
    await session.signIn('ana@islapay.cu', PASSWORD);

    expect(await session.accessToken()).toBe(token(1));
    time.advance(40_000);
    expect(await session.accessToken()).toBe(token(1));
    expect(refreshes).toBe(0);

    // Fifteen seconds before the end, not at it: a request started now must
    // not arrive carrying a token that died on the way.
    time.advance(6_000);
    expect(await session.accessToken()).toBe(token(2));
    expect(refreshes).toBe(1);
  });

  it('refreshes once however many requests find the token expired together', async () => {
    let refreshes = 0;
    server.use(
      login(1),
      http.post(`${API}/v1/auth/token/refresh`, async () => {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(pair(2));
      }),
    );
    const time = clock();
    const session = new Session(undefined, new MemoryStorage(), time.now);
    await session.signIn('ana@islapay.cu', PASSWORD);
    time.advance(60_000);

    // The reconciliation screen polls and the funds screen refetches on focus:
    // several requests finding the token dead at once is the normal case.
    // Keycloak rotates refresh tokens, so a second independent refresh would
    // present one the first had just spent — and end the session.
    const tokens = await Promise.all(Array.from({ length: 5 }, () => session.accessToken()));

    expect(refreshes).toBe(1);
    expect(new Set(tokens)).toEqual(new Set([token(2)]));
  });

  it('does not refresh again for a 401 that another request already answered', async () => {
    let refreshes = 0;
    server.use(
      login(1),
      http.post(`${API}/v1/auth/token/refresh`, () => HttpResponse.json(pair(1 + ++refreshes))),
    );
    const session = new Session(undefined, new MemoryStorage());
    await session.signIn('ana@islapay.cu', PASSWORD);

    expect(await session.forceRefresh(token(1))).toBe(token(2));
    // A second request refused with the *same* old token arrives late. The
    // session has moved on already; it gets the new token, not a new refresh.
    expect(await session.forceRefresh(token(1))).toBe(token(2));
    expect(refreshes).toBe(1);
  });

  it('ends when the server refuses the refresh, and says why', async () => {
    server.use(
      login(1),
      http.post(`${API}/v1/auth/token/refresh`, () => problem(401, 'token_invalid')),
    );
    const storage = new MemoryStorage();
    const time = clock();
    const session = new Session(undefined, storage, time.now);
    await session.signIn('ana@islapay.cu', PASSWORD);
    time.advance(60_000);

    expect(await session.accessToken()).toBeUndefined();
    expect(session.operator).toBeNull();
    expect(session.ended).toBe('expired');
    expect(storage.length).toBe(0);
  });

  it('keeps the session through a network failure, which says nothing about it', async () => {
    server.use(login(1), http.post(`${API}/v1/auth/token/refresh`, () => HttpResponse.error()));
    const time = clock();
    const session = new Session(undefined, new MemoryStorage(), time.now);
    await session.signIn('ana@islapay.cu', PASSWORD);
    time.advance(60_000);

    // Signing a treasurer out because the Wi-Fi dropped for a second would be
    // wrong: the refresh token is still good.
    await expect(session.accessToken()).rejects.toThrow();
    expect(session.operator).not.toBeNull();
  });

  it('picks up after a reload from the refresh token the tab kept', async () => {
    server.use(http.post(`${API}/v1/auth/token/refresh`, () => HttpResponse.json(pair(7))));
    const storage = new MemoryStorage();
    storage.setItem('islapay.console.refresh', 'refresh-6');

    const session = new Session(undefined, storage);

    expect(await session.restore()).toBe(true);
    expect(session.operator?.email).toBe('ana@islapay.cu');
    expect(storage.values()).toEqual(['refresh-7']);
  });

  it('starts signed out in a tab that never signed in', async () => {
    const session = new Session(undefined, new MemoryStorage());

    expect(await session.restore()).toBe(false);
    expect(session.operator).toBeNull();
    expect(session.ended).toBeNull();
  });

  it('signs out here even when the server cannot be told', async () => {
    server.use(login(1), http.post(`${API}/v1/auth/logout`, () => HttpResponse.error()));
    const storage = new MemoryStorage();
    const session = new Session(undefined, storage);
    await session.signIn('ana@islapay.cu', PASSWORD);

    await session.signOut();

    // A sign-out that failed because the network was down, and left the
    // treasurer signed in, would be worse than one that forgot to tell the
    // server.
    expect(session.operator).toBeNull();
    expect(storage.length).toBe(0);
    expect(session.ended).toBeNull();
  });

  it('tells the server, so a copy of the refresh token is worthless', async () => {
    let revoked: unknown = null;
    let bearer: string | null = null;
    server.use(
      login(1),
      http.post(`${API}/v1/auth/logout`, async ({ request }) => {
        revoked = await request.json();
        bearer = request.headers.get('Authorization');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const session = new Session(undefined, new MemoryStorage());
    await session.signIn('ana@islapay.cu', PASSWORD);

    await session.signOut();

    expect(revoked).toEqual({ refreshToken: 'refresh-1' });
    expect(bearer).toBe(`Bearer ${token(1)}`);
  });
});

describe('El cliente del API', () => {
  it('retries a 401 once, with the refreshed token', async () => {
    const seen: (string | null)[] = [];
    server.use(
      login(1),
      http.post(`${API}/v1/auth/token/refresh`, () => HttpResponse.json(pair(2))),
      http.get(`${API}/v1/admin/treasury/balances`, ({ request }) => {
        const bearer = request.headers.get('Authorization');
        seen.push(bearer);
        // The first token died in flight; the server has moved on.
        return bearer === `Bearer ${token(1)}`
          ? problem(401, 'token_invalid')
          : HttpResponse.json({ asOf: '2026-09-22T14:05:09.123Z', accounts: [] });
      }),
    );
    const session = new Session(undefined, new MemoryStorage());
    await session.signIn('ana@islapay.cu', PASSWORD);

    const balances = await unwrap(createApi(session).GET('/v1/admin/treasury/balances', {}));

    expect(balances.accounts).toEqual([]);
    expect(seen).toEqual([`Bearer ${token(1)}`, `Bearer ${token(2)}`]);
  });

  it('gives up after one retry, rather than looping on a session that is gone', async () => {
    let calls = 0;
    server.use(
      login(1),
      http.post(`${API}/v1/auth/token/refresh`, () => HttpResponse.json(pair(2))),
      http.get(`${API}/v1/admin/treasury/balances`, () => {
        calls++;
        return problem(401, 'token_invalid');
      }),
    );
    const session = new Session(undefined, new MemoryStorage());
    await session.signIn('ana@islapay.cu', PASSWORD);

    await expect(
      unwrap(createApi(session).GET('/v1/admin/treasury/balances', {})),
    ).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(2);
  });

  it('resends the same body and the same key after a 401', async () => {
    const bodies: unknown[] = [];
    const keys: (string | null)[] = [];
    server.use(
      login(1),
      http.post(`${API}/v1/auth/token/refresh`, () => HttpResponse.json(pair(2))),
      http.post(`${API}/v1/admin/treasury/credits`, async ({ request }) => {
        bodies.push(await request.json());
        keys.push(request.headers.get('Idempotency-Key'));
        return bodies.length === 1
          ? problem(401, 'token_invalid')
          : HttpResponse.json({
              postingId: '0195f2ac-0000-7000-8000-000000000001',
              destination: 'float',
              amount: { amount: '10.00', currency: 'EISLA' },
              balanceAfter: { amount: '10.00', currency: 'EISLA' },
              source: 'capital',
              reason: 'Prueba',
              by: 'op-1',
              at: '2026-09-22T14:05:09.123Z',
              applied: true,
            });
      }),
    );
    const session = new Session(undefined, new MemoryStorage());
    await session.signIn('ana@islapay.cu', PASSWORD);

    await unwrap(
      createApi(session).POST('/v1/admin/treasury/credits', {
        body: {
          destination: 'float',
          amount: { amount: '10.00', currency: 'EISLA' },
          source: 'capital',
          reason: 'Prueba',
        },
        headers: { 'Idempotency-Key': 'k-1' },
      }),
    );

    // The body is read twice, which only works because the request was cloned
    // before the first send; and the key is the same, which is what makes the
    // retry of a money movement safe even if a 401 were ever decided late.
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(keys).toEqual(['k-1', 'k-1']);
  });
});
