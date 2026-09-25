import createClient from 'openapi-fetch';
import type { Client } from 'openapi-fetch';
import { config } from '../config';
import type { paths } from './schema';
import { ApiFailure, Unreachable } from './problems';
import type { ApiProblem } from './problems';
import type { TokenSource } from '../auth/session';

/**
 * The typed client, generated from the server's own specification.
 *
 * Nothing in this repository writes a URL or a response shape by hand. The
 * console is a separate project that will never link against the backend's
 * assemblies, so the alternative is transcribing what somebody saw in a
 * response — and a transcription drifts silently. `npm run api` regenerates
 * `schema.d.ts` from `/openapi/v1.json`, and a route or a field that changes
 * shape stops compiling here rather than failing in front of a treasurer.
 *
 * A 401 is retried once, with a fresh token. Access tokens here live sixty
 * seconds, so a request that set off with a good one and arrived with a dead
 * one is ordinary, not an error. Only once: a second 401 means the session is
 * really gone, and looping would hide that.
 *
 * The retry is safe for the one request here that moves money, and for the
 * same reason it is safe everywhere: a 401 is decided before the endpoint
 * runs, so nothing happened, and the retried request carries the same
 * idempotency key besides.
 */
export function createApi(session: TokenSource): Client<paths> {
  return createClient<paths>({
    baseUrl: config.apiBase,
    headers: { Accept: 'application/json' },
    fetch: async (request) => {
      // Cloned before the first send, because sending consumes the body.
      const again = request.clone();

      const token = await session.accessToken();
      const first = await send(authorise(request, token));
      if (first.status !== 401 || token === undefined) return first;

      const fresh = await session.forceRefresh(token);
      if (fresh === undefined) return first;

      return send(authorise(again, fresh));
    },
  });
}

function authorise(request: Request, token: string | undefined): Request {
  if (token !== undefined) request.headers.set('Authorization', `Bearer ${token}`);
  return request;
}

async function send(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch (cause) {
    throw new Unreachable(cause);
  }
}

/**
 * Unwraps one call: the body, or a thrown failure.
 *
 * `openapi-fetch` returns `{ data, error }` and never throws, which is a
 * reasonable default and the wrong one here. Every caller is a React Query
 * function, and React Query's retry, error boundaries and mutation states are
 * all built on exceptions — a result object would mean each of them
 * re-implementing "did this work" and one of them getting it wrong.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;

  if (response.ok && data !== undefined) return data;

  // A 204 is a success with nothing to say: every switch and every published
  // price answers that way. `openapi-fetch` leaves `data` undefined for it,
  // and treating that as a failure made every one of them look refused.
  if (response.status === 204) return undefined as T;

  throw new ApiFailure(response.status, asProblem(error, response));
}

/**
 * Whatever came back, as the problem it claims to be.
 *
 * A 502 from a proxy, a 401 the authentication handler writes itself, and a
 * connection cut mid-body all reach here as something that is not an
 * `ApiProblem`. They get one made for them, so a caller never has to ask
 * whether `code` is there.
 */
function asProblem(error: unknown, response: Response): ApiProblem {
  if (isProblem(error)) return error;

  return {
    code: fallbackCode(response.status),
    title: response.statusText || 'Error',
    status: response.status,
    detail: null,
    type: '',
    instance: null,
    correlationId: null,
    meta: null,
  };
}

function isProblem(error: unknown): error is ApiProblem {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

function fallbackCode(status: number): string {
  // The two the pipeline answers without a body, and which the console has
  // something useful to say about.
  if (status === 401) return 'token_invalid';
  if (status === 403) return 'forbidden';
  return `http_${status}`;
}

/**
 * A key for one attempt at moving money.
 *
 * Minted per press and not derived from the amount and the destination: two
 * deliberate credits of the same amount to the same place are two credits, and
 * a key that collapsed them would be a treasurer's second deposit silently
 * discarded. What the key protects against is the *same* press being sent
 * twice — a dropped connection, a retry — and that is the same attempt.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
