import { useState } from 'react';
import { Card, Empty, Failure, Loading, Moment } from '../ui/components';
import { formatMoney } from '../money/money';
import type { Money } from '../money/money';
import { readMoney, useBalances, useScales } from '../api/queries';
import type { TreasuryAccount } from '../api/queries';
import { CreditDialog } from './CreditDialog';
import { Can, useCan } from '../auth/AuthProvider';
import { Entries } from './Entries';

/** What each account is for, for somebody who does not have §8.4 memorised. */
const MEANING: Readonly<Record<string, string>> = {
  float: 'Efectivo en banco o custodio. Lo que respalda los saldos.',
  settlement_fund: 'El fondo del que salen los pagos del cambio y del P2P.',
  escrow: 'Retenido por cuenta de alguien: un pedido, un trade.',
  fees: 'Comisiones ganadas.',
  external: 'Espejo de lo que hay fuera: una cadena, un banco, un carril.',
};

const ORDER = ['float', 'settlement_fund', 'escrow', 'fees', 'external'];

export function Funds() {
  const balances = useBalances();
  const scales = useScales();
  const [crediting, setCrediting] = useState(false);
  const [looking, setLooking] = useState<{ owner: string; currency: string } | null>(null);
  // Only whoever may propose sees the button: an approver or an auditor reads
  // this screen too, and a button that answers 403 explains nothing.
  const propose = useCan(Can.treasuryPropose);

  const head = (
    <div className="page-head">
      <div>
        <h1>Fondos</h1>
        <p>
          Cada cuenta que IslaPay tiene a su nombre. Los saldos del cliente no están
          aquí: eso es dinero de alguien, se lee de uno en uno, y ninguna pantalla los
          quiere todos a la vez.
        </p>
      </div>
      <div style={{ flex: 1 }} />
      {propose && (
        <button type="button" className="primary" onClick={() => setCrediting(true)}>
          Proponer ingreso
        </button>
      )}
    </div>
  );

  // The catalogue first: it is what says how many decimal places a currency
  // has, and without it no amount on this screen can be rendered at all.
  if (scales.error !== null && scales.error !== undefined) {
    return (
      <>
        {head}
        <Failure error={scales.error} />
      </>
    );
  }

  if (balances.isError) {
    return (
      <>
        {head}
        <Failure error={balances.error} />
      </>
    );
  }

  if (balances.isPending || !scales.ready) {
    return (
      <>
        {head}
        <Loading what="los saldos" />
      </>
    );
  }

  const accounts = [...balances.data.accounts].sort(compare);
  const groups = ORDER.filter((owner) => accounts.some((a) => a.owner === owner));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Fondos</h1>
          <p>
            Cada cuenta que IslaPay tiene a su nombre. Los saldos del cliente no están
            aquí: eso es dinero de alguien, se lee de uno en uno, y ninguna pantalla los
            quiere todos a la vez.
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {propose && (
          <button type="button" className="primary" onClick={() => setCrediting(true)}>
            Proponer ingreso
          </button>
        )}
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
        Leído <Moment at={balances.data.asOf} />
        {balances.isFetching && ' · actualizando…'}
      </p>

      {accounts.length === 0 ? (
        <Card>
          <Empty>
            No hay ninguna cuenta abierta todavía. Se abren solas con el primer asiento.
          </Empty>
        </Card>
      ) : (
        groups.map((owner) => (
          <Card key={owner} title={label(owner)}>
            <p className="muted" style={{ margin: 0, padding: '0 16px 12px', fontSize: 13 }}>
              {MEANING[owner]}
            </p>
            <table>
              <thead>
                <tr>
                  {owner === 'external' && <th>Espejo</th>}
                  <th>Moneda</th>
                  <th className="right">Saldo</th>
                  <th className="right">Asientos</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts
                  .filter((a) => a.owner === owner)
                  .map((account) => (
                    <Row
                      key={`${account.owner}:${account.mirror ?? ''}:${account.balance.currency}`}
                      account={account}
                      money={readMoney(account.balance, scales)}
                      onEntries={() =>
                        setLooking({
                          owner:
                            account.mirror === null
                              ? account.owner
                              : `external:${account.mirror}`,
                          currency: account.balance.currency,
                        })
                      }
                    />
                  ))}
              </tbody>
            </table>
          </Card>
        ))
      )}

      <CreditDialog open={crediting} onClose={() => setCrediting(false)} />
      {looking !== null && (
        <Entries owner={looking.owner} currency={looking.currency} onClose={() => setLooking(null)} />
      )}
    </>
  );
}

function Row({
  account,
  money,
  onEntries,
}: {
  account: TreasuryAccount;
  money: Money | null;
  onEntries: () => void;
}) {
  return (
    <tr>
      {account.owner === 'external' && <td className="num">{account.mirror}</td>}
      <td>{account.balance.currency}</td>
      <td className="right num">
        {money === null ? (
          // The catalogue has no row for this code, so there is no way to know
          // how many decimal places it has. Showing the raw string is the
          // honest answer; inventing a scale would render six places of USDT
          // as two and look entirely plausible.
          <span title="Moneda fuera del catálogo">{account.balance.amount} ?</span>
        ) : (
          <span style={money.isNegative ? { color: 'var(--ink-muted)' } : undefined}>
            {formatMoney(money)}
          </span>
        )}
      </td>
      <td className="right num muted">{account.entries}</td>
      <td className="right">
        <button type="button" className="link" onClick={onEntries}>
          Movimientos
        </button>
      </td>
    </tr>
  );
}

function label(owner: string): string {
  switch (owner) {
    case 'float':
      return 'Float';
    case 'settlement_fund':
      return 'Fondo de liquidación';
    case 'escrow':
      return 'Escrow';
    case 'fees':
      return 'Comisiones';
    case 'external':
      return 'Espejos externos';
    default:
      return owner;
  }
}

function compare(a: TreasuryAccount, b: TreasuryAccount): number {
  const byOwner = ORDER.indexOf(a.owner) - ORDER.indexOf(b.owner);
  if (byOwner !== 0) return byOwner;

  const byMirror = (a.mirror ?? '').localeCompare(b.mirror ?? '');
  if (byMirror !== 0) return byMirror;

  return a.balance.currency.localeCompare(b.balance.currency);
}

