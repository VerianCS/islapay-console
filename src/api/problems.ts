import type { components } from './schema';

/** The body of every refusal the API makes. */
export type ApiProblem = components['schemas']['ApiProblem'];

/**
 * A refusal, as something that can be thrown and caught.
 *
 * `code` is the only field to branch on — the same rule the mobile client
 * follows and the same rule the server states in its own specification.
 * `detail` is the server's words, for a log; it is neither translated nor
 * written for a person, so nothing here shows it to one.
 */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiProblem,
  ) {
    super(problem.detail ?? problem.code);
    this.name = 'ApiFailure';
  }

  get code(): string {
    return this.problem.code;
  }

  /** The trace id, so a screenshot and a log line can be tied together. */
  get correlationId(): string | null {
    return this.problem.correlationId ?? null;
  }

  meta(key: string): string | undefined {
    const value = (this.problem.meta as Record<string, unknown> | null | undefined)?.[key];
    return typeof value === 'string' ? value : undefined;
  }
}

/** The network never answered, or answered something that was not a problem. */
export class Unreachable extends Error {
  constructor(cause?: unknown) {
    super('No se pudo contactar con el servidor.');
    this.name = 'Unreachable';
    this.cause = cause;
  }
}

/**
 * What a person is told, by code.
 *
 * In Spanish, because the people who work this console do. Written for
 * somebody who has to decide what to do next rather than for a developer
 * reading a log — which is why an unknown code says what it is rather than
 * pretending to explain: "algo salió mal" tells a treasurer nothing, and the
 * code is what they will put in the message when they ask.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  forbidden:
    'Tu cuenta no tiene el rol treasury-admin. Alguien con acceso a Keycloak ' +
    'tiene que concedértelo.',
  token_invalid: 'La sesión caducó. Vuelve a entrar.',
  unknown_destination:
    'Sólo se puede acreditar al float o al fondo de liquidación. El escrow ' +
    'retiene dinero contra un pedido con nombre, y las comisiones se ganan.',
  invalid_credit:
    'El ingreso necesita un importe positivo, un origen y un motivo.',
  unknown_account: 'Esa cuenta no está en el plan de cuentas.',
  currency_unavailable: 'Esa moneda no está listada, o está apagada.',
  unknown_currency: 'Esa moneda no está en el catálogo.',
  unknown_network: 'Esa red no está en el catálogo.',
  idempotency_key_reuse:
    'Se reutilizó una clave de idempotencia con otra petición. Es un fallo del ' +
    'cliente: recarga la página y vuelve a intentarlo.',
  request_in_flight:
    'La misma petición todavía se está procesando. Espera un momento antes de ' +
    'repetirla.',
  malformed_request: 'El servidor no pudo leer la petición.',
};

export function describe(error: unknown): string {
  if (error instanceof ApiFailure) {
    return MESSAGES[error.code] ?? `El servidor rechazó la operación: ${error.code}.`;
  }

  if (error instanceof Unreachable) return error.message;

  return 'Algo falló antes de llegar al servidor.';
}
