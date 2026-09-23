import type { components } from '../api/schema';

/** What a currency needs to be rendered: its code and its decimal places. */
export interface Currency {
  readonly code: string;
  readonly scale: number;
}

/** Money as it travels: `{ amount: "100.50", currency: "EISLA" }`. */
export type WireMoney = components['schemas']['Money'];

/**
 * An amount of one currency, in whole minor units.
 *
 * A `bigint`, and never a `number`. The reason is the whole reason this file
 * exists: `0.1 + 0.2` is `0.30000000000000004` in JavaScript, and a console
 * whose job is to say how much money the company has must not be the place
 * where that shows up. Sums here are exact, and the only conversion to a
 * decimal happens on the way to the screen.
 *
 * The scale comes from the catalogue rather than from the string. USDT has six
 * decimal places and E-ISLA has two, and an amount that parsed its own scale
 * out of `"5.0"` would decide that one was zero — then disagree with the
 * server the moment anything was added to it.
 */
export class Money {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: Currency,
  ) {}

  static fromMinorUnits(minorUnits: bigint, currency: Currency): Money {
    return new Money(minorUnits, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  /**
   * Reads the wire form.
   *
   * @throws {UnknownCurrency} when the catalogue has never heard of the code.
   * Refused rather than guessed: a default scale of two would render six
   * decimal places of USDT as ten thousand times too much, and it would look
   * entirely plausible.
   */
  static parse(wire: WireMoney, scales: CurrencyScales): Money {
    const currency = scales.find(wire.currency);
    if (!currency) throw new UnknownCurrency(wire.currency);
    return new Money(parseMinorUnits(wire.amount, currency.scale), currency);
  }

  /** Reads a decimal a person typed, in a currency already chosen. */
  static parseAmount(amount: string, currency: Currency): Money {
    return new Money(parseMinorUnits(amount, currency.scale), currency);
  }

  plus(other: Money): Money {
    this.sameCurrencyAs(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  minus(other: Money): Money {
    this.sameCurrencyAs(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  get isZero(): boolean {
    return this.minorUnits === 0n;
  }

  get isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  get isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  /** The plain decimal, with every place the currency has. */
  toString(): string {
    const negative = this.minorUnits < 0n;
    const digits = (negative ? -this.minorUnits : this.minorUnits).toString();
    const scale = this.currency.scale;

    if (scale === 0) return `${negative ? '-' : ''}${digits}`;

    const padded = digits.padStart(scale + 1, '0');
    const whole = padded.slice(0, padded.length - scale);
    const fraction = padded.slice(padded.length - scale);
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  /** The wire form, ready to send back. */
  toWire(): WireMoney {
    return { amount: this.toString(), currency: this.currency.code };
  }

  private sameCurrencyAs(other: Money): void {
    if (other.currency.code !== this.currency.code) {
      throw new TypeError(
        `${this.currency.code} and ${other.currency.code} cannot be added: ` +
          'that is not arithmetic, it is a guess about the rate.',
      );
    }
  }
}

/** Where a code's decimal places come from. */
export interface CurrencyScales {
  find(code: string): Currency | undefined;
}

export class UnknownCurrency extends Error {
  constructor(readonly code: string) {
    super(
      `'${code}' is not in the catalogue, so there is no way to know how many ` +
        'decimal places it has.',
    );
    this.name = 'UnknownCurrency';
  }
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * A decimal string into whole minor units, without ever becoming a float.
 *
 * More decimals than the currency has is refused rather than rounded. Rounding
 * here would silently move somebody's money, and the only caller that can have
 * produced such a string is one that already disagrees with the server about
 * what the currency is.
 */
export function parseMinorUnits(amount: string, scale: number): bigint {
  const trimmed = amount.trim();
  if (!DECIMAL.test(trimmed)) {
    throw new TypeError(`'${amount}' is not a decimal amount.`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  if (fraction.length > scale) {
    throw new TypeError(
      `'${amount}' has ${fraction.length} decimal places and the currency has ${scale}.`,
    );
  }

  const minor = BigInt(whole + fraction.padEnd(scale, '0'));
  return negative ? -minor : minor;
}

/**
 * How an amount is shown: grouped, signed, and in the reader's locale.
 *
 * Built from the string rather than from a number, so nothing is rounded on
 * the way out. `Intl.NumberFormat` is given the decimal as a string, which it
 * accepts and formats exactly.
 */
export function formatMoney(
  money: Money,
  options: { readonly locale?: string; readonly signed?: boolean } = {},
): string {
  const { locale = 'es-CU', signed = false } = options;

  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: money.currency.scale,
    maximumFractionDigits: money.currency.scale,
    signDisplay: signed ? 'exceptZero' : 'auto',
  });

  // The decimal string, not a number. `Intl.NumberFormat` accepts one and
  // formats it exactly; going through a `number` first is the one place the
  // rest of this file is careful to avoid. The cast is to
  // `StringNumericLiteral`, a template-literal type no runtime string can
  // satisfy — the check it performs is one TypeScript cannot do here, and the
  // tests above are what actually hold this.
  const exact = money.toString() as Intl.StringNumericLiteral;
  return `${formatter.format(exact)} ${money.currency.code}`;
}
