import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWith } from '../test/harness';
import { API, catalogue, problem, server } from '../test/server';
import { Funds } from './Funds';

function balances(accounts: unknown[]) {
  return http.get(`${API}/v1/admin/treasury/balances`, () =>
    HttpResponse.json({ asOf: '2026-09-22T14:05:09.123Z', accounts }),
  );
}

describe('Fondos', () => {
  it('renders every amount at the scale the catalogue gives it', async () => {
    server.use(
      catalogue(),
      balances([
        {
          owner: 'float',
          mirror: null,
          balance: { amount: '1500.00', currency: 'EISLA' },
          entries: 3,
        },
        {
          owner: 'float',
          mirror: null,
          balance: { amount: '0.000001', currency: 'USDT' },
          entries: 1,
        },
      ]),
    );

    renderWith(<Funds />);

    // Six places for USDT and two for E-ISLA, from the table rather than from
    // a default. A console that rendered USDT with two would be showing ten
    // thousand times too little, and it would look entirely plausible.
    //
    // Cuban Spanish groups with a comma and points the decimal, like the US
    // and unlike Spain — which this test got wrong first and CLDR settled.
    expect(await screen.findByText('1,500.00 EISLA')).toBeInTheDocument();
    expect(screen.getByText('0.000001 USDT')).toBeInTheDocument();
  });

  it('shows a mirror as the negative it is', async () => {
    server.use(
      catalogue(),
      balances([
        {
          owner: 'external',
          mirror: 'bank:bandec',
          balance: { amount: '-1500.00', currency: 'EISLA' },
          entries: 1,
        },
      ]),
    );

    renderWith(<Funds />);

    expect(await screen.findByText('bank:bandec')).toBeInTheDocument();
    expect(screen.getByText('-1,500.00 EISLA')).toBeInTheDocument();
  });

  it('says so, rather than inventing a scale, for a currency the catalogue lacks', async () => {
    server.use(
      catalogue(),
      balances([
        {
          owner: 'escrow',
          mirror: null,
          balance: { amount: '12.345678', currency: 'DOGE' },
          entries: 2,
        },
      ]),
    );

    renderWith(<Funds />);

    // The raw string with a question mark. Guessing two places here is how a
    // figure becomes wrong by a factor of ten thousand while looking fine.
    expect(await screen.findByText(/12\.345678 \?/)).toBeInTheDocument();
  });

  it('explains a 403 instead of showing an empty table', async () => {
    server.use(catalogue(), http.get(`${API}/v1/admin/treasury/balances`, () =>
      problem(403, 'forbidden'),
    ));

    renderWith(<Funds />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/treasury-admin/);
    // The correlation id, because asking for it after the page is reloaded
    // never works.
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('does not hold the screen hostage to an empty book', async () => {
    server.use(catalogue(), balances([]));

    renderWith(<Funds />);

    await waitFor(() =>
      expect(screen.getByText(/no hay ninguna cuenta abierta/i)).toBeInTheDocument(),
    );
  });
});
