import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWith } from '../test/harness';
import { API, catalogue, server } from '../test/server';
import { Reconciliation } from './Reconciliation';

function eisla(amount: string) {
  return { amount, currency: 'EISLA' };
}

function report(currencies: unknown[], balanced: boolean) {
  return http.get(`${API}/v1/admin/treasury/reconciliation`, () =>
    HttpResponse.json({ asOf: '2026-09-22T14:05:09.123Z', balanced, currencies }),
  );
}

describe('Conciliación', () => {
  it('says it balances when the modules account for all of it', async () => {
    server.use(
      catalogue(),
      report(
        [
          {
            currency: 'EISLA',
            ledger: eisla('300.00'),
            claimed: eisla('300.00'),
            inFlight: eisla('0.00'),
            difference: eisla('0.00'),
            balanced: true,
            claims: [
              { context: 'marketplace', held: eisla('200.00'), inFlight: eisla('0.00') },
              { context: 'p2p', held: eisla('100.00'), inFlight: eisla('0.00') },
            ],
          },
        ],
        true,
      ),
    );

    renderWith(<Reconciliation />);

    expect(await screen.findByText(/^Cuadra\./)).toBeInTheDocument();
    expect(screen.getByText('Cuadra', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('marketplace')).toBeInTheDocument();
    expect(screen.getByText('p2p')).toBeInTheDocument();
  });

  it('distinguishes money in flight from an alarm', async () => {
    server.use(
      catalogue(),
      report(
        [
          {
            currency: 'EISLA',
            ledger: eisla('300.00'),
            claimed: eisla('220.00'),
            inFlight: eisla('80.00'),
            difference: eisla('0.00'),
            balanced: true,
            claims: [
              { context: 'marketplace', held: eisla('220.00'), inFlight: eisla('80.00') },
            ],
          },
        ],
        true,
      ),
    );

    renderWith(<Reconciliation />);

    // Inside the band with something in flight is "ask again in a moment",
    // not agreement and not an alarm. An alarm that cries wolf is the one
    // people learn to dismiss.
    expect(await screen.findByText(/dinero en vuelo/)).toBeInTheDocument();
    // The verdict, not the column of the same name.
    expect(screen.getByText('En vuelo', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.queryByText('Cuadra')).not.toBeInTheDocument();
  });

  it('names which way it is wrong when escrow is short', async () => {
    server.use(
      catalogue(),
      report(
        [
          {
            currency: 'EISLA',
            ledger: eisla('20.00'),
            claimed: eisla('40.00'),
            inFlight: eisla('0.00'),
            difference: eisla('-20.00'),
            balanced: false,
            claims: [{ context: 'marketplace', held: eisla('40.00'), inFlight: eisla('0.00') }],
          },
        ],
        false,
      ),
    );

    renderWith(<Reconciliation />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/No cuadra/);
    // The sign is the whole finding: a buyer is owed a refund escrow cannot
    // pay, which is the worse of the two failures.
    expect(screen.getByText('Falta dinero')).toBeInTheDocument();
    expect(screen.getByText(/reembolso pendiente/)).toBeInTheDocument();
  });

  it('names the other direction too', async () => {
    server.use(
      catalogue(),
      report(
        [
          {
            currency: 'EISLA',
            ledger: eisla('45.00'),
            claimed: eisla('0.00'),
            inFlight: eisla('0.00'),
            difference: eisla('45.00'),
            balanced: false,
            claims: [],
          },
        ],
        false,
      ),
    );

    renderWith(<Reconciliation />);

    expect(await screen.findByText('Sobra dinero')).toBeInTheDocument();
    expect(screen.getByText(/ningún módulo reclama nada/i)).toBeInTheDocument();
  });

  it('does not call an empty question an agreement', async () => {
    server.use(catalogue(), report([], true));

    renderWith(<Reconciliation />);

    // The server answers `balanced: true` when there is nothing to compare,
    // which is correct and would be a lie on screen: a green "cuadra" over an
    // empty table claims a check was made that was not.
    expect(await screen.findByText(/todavía no hay pregunta/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Cuadra\./)).not.toBeInTheDocument();
  });
});
