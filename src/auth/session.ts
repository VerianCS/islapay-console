import createClient from 'openapi-fetch';
import type { Client } from 'openapi-fetch';
import { config } from '../config';
import type { paths } from '../api/schema';
import { ApiFailure, Unreachable } from '../api/problems';
import { unwrap } from '../api/client';
import { readClaims, realmRoles } from './jwt';

/** Who is signed in, as this console needs them. */
export interface Operator {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly string[];
}

/**
 * What the API client needs from a session, and nothing else.
 *
 * Narrow so a test can supply one in two lines, and so the client cannot
 * reach into the session and start signing people in or out.
 */
export interface TokenSource {
  /** A token good for at least a few more seconds, refreshed first if not. */
  accessToken(): Promise<string | undefined>;

  /**
   * A token other than `stale`, after the server refused it.
   *
   * Takes the token that failed so that ten requests refused by the same
   * expired token cause one refresh and not ten: whoever arrives after the
   * first has refreshed gets the new token without asking again.
   */
  forceRefresh(stale: string): Promise<string | undefined>;
}

/** Why a session ended without anybody pressing "Salir". */
export type Ended = 'expired' | null;

/**
 * Signing in with a password, through the same route the mobile app uses.
 *
 * `POST /v1/auth/login` is the Resource Owner Password grant in all but name.
 * The backend documents what that costs and the console inherits it: the
 * password passes through this page, so it is never stored, never logged and
 * never kept in state after the request; and a second factor or single sign-on
 * cannot be added through this door. If either becomes a requirement, this is
 * replaced by authorization code with PKCE at Keycloak.
 *
 * The access token lives in memory only. The refresh token lives in
 * `sessionStorage`, so a reload keeps the treasurer signed in and closing the
 * tab does not — `localStorage` would outlive the tab, be shared by every tab,
 * and be readable by anything that ever runs a script on this origin.
 */
export class Session implements TokenSource {
  private access: string | undefined;
  private refresh: string | undefined;
  private expiresAt = 0;
  private refreshing: Promise<string | undefined> | null = null;
  private readonly listeners = new Set<() => void>();

  private _operator: Operator | null = null;
  private _ended: Ended = null;

  constructor(
    private readonly auth: Client<paths> = createClient<paths>({ baseUrl: config.apiBase }),
    private readonly storage: Storage | null = safeSessionStorage(),
    private readonly now: () => number = Date.now,
  ) {}

  get operator(): Operator | null {
    return this._operator;
  }

  get ended(): Ended {
    return this._ended;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Signs in. Throws the server's refusal as an `ApiFailure`.
   *
   * The password is a parameter and goes nowhere but the request body.
   */
  async signIn(email: string, password: string): Promise<void> {
    const session = await unwrap(
      guard(this.auth.POST('/v1/auth/login', { body: { email: email.trim(), password } })),
    );
    this.adopt(session.tokens);
  }

  /**
   * Picks up where a reload left off, if the tab still has a refresh token.
   *
   * Answers false rather than throwing when there is nothing to restore or it
   * has expired: that is the normal state of a new tab, not a failure.
   */
  async restore(): Promise<boolean> {
    this.refresh = this.storage?.getItem(REFRESH_KEY) ?? undefined;
    if (this.refresh === undefined) return false;

    return (await this.refreshNow()) !== undefined;
  }

  async accessToken(): Promise<string | undefined> {
    if (this.access !== undefined && this.now() < this.expiresAt - EARLY_MS) {
      return this.access;
    }
    if (this.refresh === undefined) return undefined;

    return this.refreshNow();
  }

  async forceRefresh(stale: string): Promise<string | undefined> {
    // Somebody else already replaced it while this request was in flight.
    if (this.access !== undefined && this.access !== stale) return this.access;
    if (this.refresh === undefined) return undefined;

    return this.refreshNow();
  }

  /**
   * Signs out here and at the server.
   *
   * The local half happens first and unconditionally: a sign-out that failed
   * because the network was down and left the treasurer signed in would be
   * worse than one that forgot to tell Keycloak. The server half is best
   * effort, and revokes the refresh token so a copy of it is worthless.
   */
  async signOut(): Promise<void> {
    const access = this.access;
    const refresh = this.refresh;
    this.clear(null);

    if (access === undefined || refresh === undefined) return;

    try {
      await this.auth.POST('/v1/auth/logout', {
        body: { refreshToken: refresh },
        headers: { Authorization: `Bearer ${access}` },
      });
    } catch {
      // Already signed out locally. Nothing useful to tell anybody.
    }
  }

  /**
   * One refresh at a time, shared by everybody who needs it.
   *
   * With a sixty-second access token and a reconciliation screen that polls,
   * two requests finding the token expired at once is the normal case rather
   * than a race. Keycloak rotates the refresh token, so the second of two
   * independent refreshes would present one the first had just spent — and be
   * told the session is over.
   */
  private refreshNow(): Promise<string | undefined> {
    this.refreshing ??= this.exchange().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async exchange(): Promise<string | undefined> {
    const token = this.refresh;
    if (token === undefined) return undefined;

    try {
      const pair = await unwrap(
        guard(this.auth.POST('/v1/auth/token/refresh', { body: { refreshToken: token } })),
      );
      this.adopt(pair);
      return this.access;
    } catch (error) {
      // The server said no: the refresh token has expired or been revoked,
      // and nothing this tab can do will change that.
      if (error instanceof ApiFailure && error.status < 500) {
        this.clear('expired');
        return undefined;
      }
      // Anything else — the network, a 503 — says nothing about the session.
      // Keep it, and let the caller report the failure it actually had.
      throw error;
    }
  }

  private adopt(pair: { accessToken: string; refreshToken: string; expiresIn: number }): void {
    this.access = pair.accessToken;
    this.refresh = pair.refreshToken;
    // From when the response arrived, not from the token's `exp`: this
    // machine's clock may be minutes off the server's, and the relative figure
    // is immune to that.
    this.expiresAt = this.now() + pair.expiresIn * 1000;
    this.storage?.setItem(REFRESH_KEY, pair.refreshToken);

    this._operator = toOperator(pair.accessToken);
    this._ended = null;
    this.notify();
  }

  private clear(reason: Ended): void {
    this.access = undefined;
    this.refresh = undefined;
    this.expiresAt = 0;
    this.storage?.removeItem(REFRESH_KEY);

    this._operator = null;
    this._ended = reason;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

const REFRESH_KEY = 'islapay.console.refresh';

/**
 * How early a token is replaced.
 *
 * Fifteen seconds, so a request started now does not arrive after the token it
 * carries has died. With a sixty-second lifetime anything much larger would
 * refresh on nearly every request.
 */
const EARLY_MS = 15_000;

function toOperator(accessToken: string): Operator | null {
  const claims = readClaims(accessToken);
  if (!claims || typeof claims['sub'] !== 'string') return null;

  return {
    id: claims['sub'],
    name: typeof claims['name'] === 'string' ? claims['name'] : claims['sub'],
    email: typeof claims['email'] === 'string' ? claims['email'] : '',
    roles: realmRoles(claims),
  };
}

/** A network failure, as the same `Unreachable` the API client raises. */
async function guard<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (cause) {
    throw new Unreachable(cause);
  }
}

/**
 * `sessionStorage`, or nothing.
 *
 * It throws in some private modes and in sandboxed frames. Without it the
 * console still works; a reload just signs the treasurer out.
 */
function safeSessionStorage(): Storage | null {
  try {
    const storage = window.sessionStorage;
    storage.getItem(REFRESH_KEY);
    return storage;
  } catch {
    return null;
  }
}
