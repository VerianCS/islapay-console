import { Badge, Card, Empty, Failure, Loading, Moment, Note } from '../ui/components';
import { formatMoney } from '../money/money';
import { readMoney, useReconciliation, useScales } from '../api/queries';
import type { EscrowRow } from '../api/queries';

/**
 * Escrow, as the ledger has it against what the modules say it should be.
 *
 * One light at the top, and the table underneath. A console that makes
 * somebody scan a table to find out whether anything is wrong is a console
 * nobody checks — and this is the screen whose whole job is to be checked at a
 * glance and then closed.
 */
export function Reconciliation() {
  const report = useReconciliation();
  const scales = useScales();

  if (report.isPending || !scales.ready) return <Loading what="la conciliación" />;
  if (report.isError) return <Failure error={report.error} />;

  const inFlight = report.data.currencies.some((row) => !isZero(row.inFlight.amount));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conciliación</h1>
          <p>
            El escrow es una sola cuenta por moneda y tres módulos meten dinero en ella.
            El libro sabe el total y no sabe por qué; cada módulo sabe sus razones y no ve
            las de los demás. Aquí se comparan.
          </p>
        </div>
      </div>

      {report.data.balanced ? (
        <Note tone={inFlight ? 'warn' : 'ok'}>
          {inFlight
            ? 'Cuadra, con dinero en vuelo. Un asiento pedido y todavía sin confirmar cae ' +
              'dentro de la banda: vuelve a mirar en un momento.'
            : 'Cuadra. Lo que retiene el escrow es exactamente lo que los módulos dicen deber.'}
        </Note>
      ) : (
        <Note tone="alarm">
          No cuadra. O un módulo perdió el rastro de una retención, o salió dinero del
          escrow sin ella — y de las dos maneras el usuario no vio nada raro.
        </Note>
      )}

      <p className="muted" style={{ fontSize: 13 }}>
        Leído <Moment at={report.data.asOf} />
        {report.isFetching && ' · actualizando…'} · se refresca solo cada 30 s
      </p>

      {report.data.currencies.length === 0 ? (
        <Card>
          <Empty>
            El escrow no retiene nada y ningún módulo reclama nada. No hay qué conciliar.
          </Empty>
        </Card>
      ) : (
        report.data.currencies.map((row) => <CurrencyRow key={row.currency} row={row} scales={scales} />)
      )}
    </>
  );
}

function CurrencyRow({
  row,
  scales,
}: {
  row: EscrowRow;
  scales: ReturnType<typeof useScales>;
}) {
  const ledger = readMoney(row.ledger, scales);
  const claimed = readMoney(row.claimed, scales);
  const inFlight = readMoney(row.inFlight, scales);
  const difference = readMoney(row.difference, scales);

  const show = (amount: typeof ledger, wire: { amount: string; currency: string }) =>
    amount === null ? `${wire.amount} ${wire.currency}` : formatMoney(amount);

  return (
    <Card
      title={row.currency}
      aside={
        row.balanced ? (
          inFlight !== null && !inFlight.isZero ? (
            <Badge tone="warn">En vuelo</Badge>
          ) : (
            <Badge tone="ok">Cuadra</Badge>
          )
        ) : (
          <Badge tone="alarm">
            {difference !== null && difference.isNegative ? 'Falta dinero' : 'Sobra dinero'}
          </Badge>
        )
      }
    >
      <table>
        <thead>
          <tr>
            <th>Contexto</th>
            <th className="right">Retiene</th>
            <th className="right">En vuelo</th>
          </tr>
        </thead>
        <tbody>
          {row.claims.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">
                Ningún módulo reclama nada en esta moneda.
              </td>
            </tr>
          ) : (
            row.claims.map((claim) => (
              <tr key={claim.context}>
                <td>{claim.context}</td>
                <td className="right num">{show(readMoney(claim.held, scales), claim.held)}</td>
                <td className="right num muted">
                  {isZero(claim.inFlight.amount)
                    ? '—'
                    : show(readMoney(claim.inFlight, scales), claim.inFlight)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <strong>Suman</strong>
            </td>
            <td className="right num">
              <strong>{show(claimed, row.claimed)}</strong>
            </td>
            <td className="right num muted">{show(inFlight, row.inFlight)}</td>
          </tr>
          <tr>
            <td>
              El libro <span className="muted">· cuenta de escrow</span>
            </td>
            <td className="right num">
              <strong>{show(ledger, row.ledger)}</strong>
            </td>
            <td />
          </tr>
          {!row.balanced && (
            <tr>
              <td style={{ color: 'var(--alarm)' }}>
                <strong>Diferencia</strong>
                <br />
                <span style={{ fontSize: 12, fontWeight: 400 }}>
                  {difference !== null && difference.isNegative
                    ? 'Un módulo espera dinero que el escrow no tiene. Alguien tiene un ' +
                      'reembolso pendiente que no se puede pagar.'
                    : 'El escrow retiene dinero que ningún módulo explica.'}
                </span>
              </td>
              <td className="right num" style={{ color: 'var(--alarm)' }}>
                <strong>{show(difference, row.difference)}</strong>
              </td>
              <td />
            </tr>
          )}
        </tfoot>
      </table>
    </Card>
  );
}

/** A zero, without needing the catalogue to say how many places it has. */
function isZero(amount: string): boolean {
  return /^-?0(\.0*)?$/.test(amount.trim());
}
