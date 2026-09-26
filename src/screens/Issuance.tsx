import { useState } from 'react';
import { readMoney, useIssuance, useProposeIssuance, useScales } from '../api/queries';
import type { Issuance as IssuanceReport, TreasuryProposal } from '../api/queries';
import { Can, useCan } from '../auth/AuthProvider';
import { Money, formatMoney, parseMinorUnits } from '../money/money';
import { Badge, Card, Failure, Field, Loading, Modal, Moment, Note } from '../ui/components';

/**
 * E-ISLA: how much is out, what backs it, and how more is made.
 *
 * Every E-ISLA comes from the issuer. Minting puts it in the settlement fund
 * (from where conversions and P2P sales hand it out) or the float; burning
 * takes it back. Both are proposals someone else approves, and a mint the
 * USDT and USDC reserves would not cover is refused at approval.
 */
export function Issuance() {
  const report = useIssuance();
  const scales = useScales();
  const propose = useCan(Can.treasuryPropose);
  const [proposing, setProposing] = useState<'mint' | 'burn' | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Emisión</h1>
          <p>
            Todo E-ISLA sale del emisor. Lo que está en circulación no puede pasar de lo que
            IslaPay tiene en USDT y USDC a su nombre.
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {propose && (
          <>
            <button type="button" className="primary" onClick={() => setProposing('mint')}>
              Proponer emisión
            </button>{' '}
            <button type="button" onClick={() => setProposing('burn')}>
              Proponer retiro
            </button>
          </>
        )}
      </div>

      {report.isError ? (
        <Card>
          <div className="card__body">
            <Failure error={report.error} />
          </div>
        </Card>
      ) : report.data === undefined || !scales.ready ? (
        <Card>
          <Loading what="la emisión" />
        </Card>
      ) : (
        <Report report={report.data} />
      )}

      {proposing !== null && (
        <ProposeDialog kind={proposing} headroom={report.data?.headroom ?? '0'} onClose={() => setProposing(null)} />
      )}
    </>
  );
}

function Report({ report }: { report: IssuanceReport }) {
  const scales = useScales();
  const outstanding = readMoney(report.outstanding, scales);

  return (
    <>
      <Card
        title="En circulación"
        aside={
          report.backed ? <Badge tone="ok">Cubierto</Badge> : <Badge tone="alarm">Sin cubrir</Badge>
        }
      >
        <div className="card__body">
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0 }}>
            <dt className="muted">E-ISLA emitido</dt>
            <dd className="num" style={{ margin: 0 }}>
              <strong>{outstanding ? formatMoney(outstanding) : report.outstanding.amount}</strong>
            </dd>
            {report.reserves.map((r) => {
              const held = readMoney(r, scales);
              return (
                <div key={r.currency} style={{ display: 'contents' }}>
                  <dt className="muted">Reserva {r.currency}</dt>
                  <dd className="num" style={{ margin: 0 }}>
                    {held ? formatMoney(held) : r.amount}
                  </dd>
                </div>
              );
            })}
            <dt className="muted">Reserva total</dt>
            <dd className="num" style={{ margin: 0 }}>
              {report.reserveTotal}
            </dd>
            <dt className="muted">Margen para emitir</dt>
            <dd className="num" style={{ margin: 0 }}>
              {report.headroom}
            </dd>
          </dl>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Leído <Moment at={report.asOf} /> — cuenta el float, el fondo de liquidación y
            las comisiones; no el escrow, que es dinero de alguien.
          </p>
        </div>
      </Card>

      {report.strays.length > 0 && (
        <Card title="E-ISLA fuera del emisor">
          <div className="card__body">
            <Note>
              Estas cuentas tienen E-ISLA negativo que no salió del emisor: circulación que la
              cifra de arriba no ve. Hay que averiguar de dónde vino.
            </Note>
            <ul>
              {report.strays.map((s) => {
                const balance = readMoney(s.balance, scales);
                return (
                  <li key={`${s.owner}:${s.mirror ?? ''}`} className="num">
                    {s.owner}
                    {s.mirror ? `:${s.mirror}` : ''} — {balance ? formatMoney(balance) : s.balance.amount}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}
    </>
  );
}

function ProposeDialog({
  kind,
  headroom,
  onClose,
}: {
  kind: 'mint' | 'burn';
  headroom: string;
  onClose: () => void;
}) {
  const scales = useScales();
  const issue = useProposeIssuance();
  const [account, setAccount] = useState('settlement_fund');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<TreasuryProposal | null>(null);

  const eisla = scales.find('EISLA');
  let amountError: string | undefined;
  if (amount.trim() !== '' && eisla) {
    try {
      if (parseMinorUnits(amount.trim(), eisla.scale) <= 0n) amountError = 'Un importe positivo.';
    } catch (e) {
      amountError = e instanceof Error ? e.message : 'No es un importe.';
    }
  }
  const complete = eisla !== undefined && amount.trim() !== '' && amountError === undefined && reason.trim().length >= 4;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || eisla === undefined) return;
    issue.mutate(
      {
        kind,
        body: {
          amount: Money.parseAmount(amount.trim(), eisla).toWire(),
          account,
          reason: reason.trim(),
        },
      },
      { onSuccess: setDone },
    );
  }

  const title = kind === 'mint' ? 'Proponer emisión de E-ISLA' : 'Proponer retiro de E-ISLA';

  if (done !== null) {
    return (
      <Modal open onClose={onClose} title="Propuesta creada">
        <div className="dialog__body">
          <Note tone="ok">
            No se ha movido nada. Otra persona la aprueba en «Aprobaciones»
            {kind === 'mint' ? ', y sólo si las reservas siguen cubriéndola en ese momento' : ''}.
          </Note>
        </div>
        <div className="dialog__foot">
          <button type="button" className="primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={kind === 'mint' ? `Margen ahora: ${headroom} E-ISLA.` : 'Vuelve al emisor y deja de circular.'}
    >
      <form onSubmit={submit}>
        <div className="dialog__body">
          {issue.isError && <Failure error={issue.error} />}
          <Field label={kind === 'mint' ? 'A dónde va' : 'De dónde sale'}>
            {(parts) => (
              <select {...parts} value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="settlement_fund">Fondo de liquidación — de donde salen las conversiones</option>
                <option value="float">Float</option>
              </select>
            )}
          </Field>
          <Field label="Importe (E-ISLA)" error={amountError}>
            {(parts) => (
              <input
                {...parts}
                inputMode="decimal"
                className="num"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            )}
          </Field>
          <Field label="Motivo">
            {(parts) => <input {...parts} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
        <div className="dialog__foot">
          <button type="button" onClick={onClose} disabled={issue.isPending}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!complete || issue.isPending}>
            {issue.isPending ? 'Proponiendo…' : kind === 'mint' ? 'Proponer emisión' : 'Proponer retiro'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
