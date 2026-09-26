import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWith, signedIn } from '../test/harness';
import { API, catalogue, problem, server } from '../test/server';
import { Issuance } from './Issuance';

function report(over: Record<string, unknown> = {}) {
  return {
    asOf: '2026-09-26T10:00:00.000Z',
    outstanding: { amount: '800.00', currency: 'EISLA' },
    reserves: [{ amount: '1000.000000', currency: 'USDT' }],
    reserveTotal: '1000',
    headroom: '200',
    backed: true,
    strays: [],
    ...over,
  };
}

describe('Emisión', () => {
  it('shows what is out, what backs it and the headroom', async () => {
    server.use(catalogue(), http.get(`${API}/v1/admin/treasury/issuance`, () => HttpResponse.json(report())));

    renderWith(<Issuance />, signedIn(['treasury.read']));

    expect(await screen.findByText('Cubierto')).toBeInTheDocument();
    expect(screen.getByText(/^800[.,]00 EISLA$/)).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    // A reader does not get the buttons.
    expect(screen.queryByRole('button', { name: /proponer emisión/i })).not.toBeInTheDocument();
  });

  it('says so when E-ISLA exists that the issuer did not put out', async () => {
    server.use(
      catalogue(),
      http.get(`${API}/v1/admin/treasury/issuance`, () =>
        HttpResponse.json(
          report({
            backed: false,
            strays: [{ owner: 'float', mirror: null, balance: { amount: '-50.00', currency: 'EISLA' }, entryCount: 3 }],
          }),
        ),
      ),
    );

    renderWith(<Issuance />, signedIn(['treasury.read']));

    expect(await screen.findByText('Sin cubrir')).toBeInTheDocument();
    expect(screen.getByText(/no salió del emisor/i)).toBeInTheDocument();
  });

  it('proposes a mint, and explains a refusal for want of reserves', async () => {
    const seen: unknown[] = [];
    server.use(
      catalogue(),
      http.get(`${API}/v1/admin/treasury/issuance`, () => HttpResponse.json(report())),
      http.post(`${API}/v1/admin/treasury/mints`, async ({ request }) => {
        seen.push(await request.json());
        return problem(422, 'reserve_insufficient');
      }),
    );
    const user = userEvent.setup();

    renderWith(<Issuance />, signedIn(['treasury.read', 'treasury.propose']));
    await user.click(await screen.findByRole('button', { name: 'Proponer emisión' }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Importe (E-ISLA)'), '500');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Existencias del cambio');
    await user.click(within(dialog).getByRole('button', { name: 'Proponer emisión' }));

    await waitFor(() =>
      expect(seen).toEqual([
        {
          amount: { amount: '500.00', currency: 'EISLA' },
          account: 'settlement_fund',
          reason: 'Existencias del cambio',
        },
      ]),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/no cubren esa emisión/i);
  });
});
