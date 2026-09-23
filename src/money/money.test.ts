import { describe, expect, it } from 'vitest';
import { Money, formatMoney, parseMinorUnits, UnknownCurrency } from './money';
import type { CurrencyScales } from './money';

const EISLA = { code: 'EISLA', scale: 2 };
const USDT = { code: 'USDT', scale: 6 };

const scales: CurrencyScales = {
  find: (code) => [EISLA, USDT].find((c) => c.code === code),
};

describe('parseMinorUnits', () => {
  it('reads a decimal exactly, at the currency’s own scale', () => {
    expect(parseMinorUnits('100.50', 2)).toBe(10050n);
    expect(parseMinorUnits('0.000001', 6)).toBe(1n);
    expect(parseMinorUnits('-4', 2)).toBe(-400n);
    expect(parseMinorUnits('5.0', 6)).toBe(5000000n);
  });

  it('refuses more decimals than the currency has, rather than rounding', () => {
    // Rounding here would silently move somebody's money, and the only caller
    // that can produce such a string already disagrees with the server about
    // what the currency is.
    expect(() => parseMinorUnits('1.005', 2)).toThrow(/2/);
  });

  it('refuses anything that is not a decimal', () => {
    for (const bad of ['', ' ', '1e3', '1,50', 'NaN', '1.2.3', '$5']) {
      expect(() => parseMinorUnits(bad, 2)).toThrow();
    }
  });
});

describe('Money', () => {
  it('survives the trip to the wire and back', () => {
    const money = Money.parse({ amount: '1234.56', currency: 'EISLA' }, scales);

    expect(money.minorUnits).toBe(123456n);
    expect(money.toWire()).toEqual({ amount: '1234.56', currency: 'EISLA' });
  });

  it('keeps the currency’s places even when the server omits them', () => {
    // The server writes "5.00"; a client that had parsed its own scale out of
    // "5" would decide E-ISLA had none.
    expect(Money.parse({ amount: '5', currency: 'EISLA' }, scales).toString()).toBe('5.00');
    expect(Money.parse({ amount: '5', currency: 'USDT' }, scales).toString()).toBe('5.000000');
  });

  it('refuses a currency the catalogue has never heard of', () => {
    // Not a default of two places: six decimal places of USDT rendered as two
    // is ten thousand times too much, and it looks entirely plausible.
    expect(() => Money.parse({ amount: '1.00', currency: 'XXX' }, scales))
      .toThrow(UnknownCurrency);
  });

  it('adds without the arithmetic every JavaScript total gets wrong', () => {
    const tenth = Money.parse({ amount: '0.10', currency: 'EISLA' }, scales);
    const fifth = Money.parse({ amount: '0.20', currency: 'EISLA' }, scales);

    // 0.1 + 0.2 === 0.30000000000000004, and this console's whole job is to
    // say how much money the company has.
    expect(tenth.plus(fifth).toString()).toBe('0.30');
  });

  it('holds a figure no double could', () => {
    // Beyond 2^53. A balance sheet in minor units reaches this sooner than
    // anybody expects: it is 90 billion E-ISLA.
    const huge = Money.fromMinorUnits(9007199254740993n, EISLA);
    expect(huge.toString()).toBe('90071992547409.93');
  });

  it('will not add two currencies', () => {
    const eisla = Money.parse({ amount: '1.00', currency: 'EISLA' }, scales);
    const usdt = Money.parse({ amount: '1.000000', currency: 'USDT' }, scales);

    expect(() => eisla.plus(usdt)).toThrow(/rate/);
  });

  it('carries a negative through, because a mirror account is one', () => {
    const mirror = Money.parse({ amount: '-250000.00', currency: 'EISLA' }, scales);

    expect(mirror.isNegative).toBe(true);
    expect(mirror.toString()).toBe('-250000.00');
    expect(mirror.toWire().amount).toBe('-250000.00');
  });
});

describe('formatMoney', () => {
  it('groups without rounding', () => {
    const money = Money.fromMinorUnits(123456789n, EISLA);
    expect(formatMoney(money, { locale: 'en-US' })).toBe('1,234,567.89 EISLA');
  });

  it('groups the way Cuba does, which is not the way Spain does', () => {
    // A comma for thousands and a point for the decimal — like the US and
    // unlike es-ES. Worth a test of its own because it is the sort of thing
    // somebody "fixes" on sight.
    const money = Money.fromMinorUnits(150000n, EISLA);
    expect(formatMoney(money)).toBe('1,500.00 EISLA');
    expect(formatMoney(money, { locale: 'es-ES' })).toBe('1500,00 EISLA');
  });

  it('shows every place a currency has, so two amounts line up', () => {
    expect(formatMoney(Money.fromMinorUnits(1n, USDT), { locale: 'en-US' }))
      .toBe('0.000001 USDT');
  });

  it('shows the sign when the reader needs it', () => {
    expect(formatMoney(Money.fromMinorUnits(500n, EISLA), { locale: 'en-US', signed: true }))
      .toBe('+5.00 EISLA');
  });
});
