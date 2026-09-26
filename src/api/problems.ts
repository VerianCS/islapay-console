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
  // Signing in. One message for a wrong address and a wrong password, as the
  // server intends: telling them apart would tell a stranger which addresses
  // have accounts.
  invalid_credentials: 'Correo o contraseña incorrectos.',
  account_disabled: 'Esta cuenta está desactivada.',
  too_many_attempts:
    'Demasiados intentos seguidos. Espera unos minutos antes de volver a probar.',
  identity_unavailable:
    'El servicio de identidad no responde. Vuelve a intentarlo en un momento.',

  forbidden:
    'Tu cuenta no tiene el permiso que pide esto. Alguien con acceso a Keycloak ' +
    'tiene que concederte el rol que lo da.',
  own_proposal:
    'Esta propuesta es tuya: la aprueba o la rechaza otra persona.',
  not_your_proposal: 'Sólo quien hizo la propuesta puede retirarla.',
  proposal_not_pending:
    'Esa propuesta ya se decidió, se retiró o venció. La lista se ha actualizado.',
  proposal_not_found: 'Esa propuesta no existe.',
  account_not_found: 'No hay ninguna cuenta con ese correo.',
  invalid_standing_change:
    'Hace falta un motivo de al menos cuatro caracteres, y el nivel 2 sólo se da a ' +
    'una cuenta con el teléfono probado.',
  account_frozen: 'La cuenta está congelada.',
  not_creditable:
    'El E-ISLA no se ingresa: no viene de fuera. Se acuña en «Emisión», contra reservas.',
  reserve_insufficient:
    'Las reservas en USDT y USDC no cubren esa emisión. Mira el margen en «Emisión».',
  burn_exceeds_balance: 'La cuenta no tiene tanto E-ISLA para retirar.',
  not_issuable: 'IslaPay sólo emite E-ISLA.',
  limit_exceeded: 'El importe supera lo que su nivel permite en un solo movimiento.',
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

  // The P2P desk.
  method_not_found: 'Ese método ya no existe.',
  method_exists: 'Ya hay un método para esa moneda: un solo método por moneda.',
  invalid_currency:
    'Esa moneda no sirve ahí: un método se abre para una moneda fiat encendida ' +
    'en el catálogo, y se cotiza contra E-ISLA, USDT o USDC.',
  invalid_limits:
    'Los límites van en la moneda del método, el mínimo por encima de cero y ' +
    'no mayor que el máximo.',
  invalid_method_name: 'El nombre tiene que tener entre 1 y 40 caracteres.',
  invalid_instructions: 'Las instrucciones no pueden pasar de 1000 caracteres.',
  rate_unavailable: 'El precio tiene que ser un decimal mayor que cero.',
  invalid_amount:
    'Falta la referencia del banco o el motivo, o el estado buscado no existe.',
  trade_not_found: 'Esa operación no existe.',
  trade_not_open:
    'La operación ya no está abierta: otra persona la cerró, o el cliente la ' +
    'canceló. Se actualiza la lista.',
  wrong_side: 'Esa acción es del otro sentido: «pagado» es de una venta, «recibido» de una compra.',
};

export function describe(error: unknown): string {
  if (error instanceof ApiFailure) {
    return MESSAGES[error.code] ?? `El servidor rechazó la operación: ${error.code}.`;
  }

  if (error instanceof Unreachable) return error.message;

  return 'Algo falló antes de llegar al servidor.';
}
