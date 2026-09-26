import { useEffect, useId, useState } from 'react';
import { newIdempotencyKey } from '../api/client';
import { readMoney, useDecideProposal, useProposals, useScales } from '../api/queries';
import type { TreasuryProposal } from '../api/queries';
import { Can, useAuth, useCan } from '../auth/AuthProvider';
import { formatMoney } from '../money/money';
import { Badge, Card, Empty, Failure, Field, Loading, Modal, Moment, Note } from '../ui/components';

const STATUS: Readonly<Record<string, { label: string; tone: 'ok' | 'warn' | 'alarm' | 'quiet' }>> = {
  pending: { label: 'Esperando', tone: 'warn' },
  approved: { label: 'Aprobada', tone: 'ok' },
  rejected: { label: 'Rechazada', tone: 'alarm' },
  withdrawn: { label: 'Retirada', tone: 'quiet' },
  expired: { label: 'Vencida', tone: 'quiet' },
};

/**
 * Money one person asked to move, waiting for a second.
 *
 * The server refuses an approval by the person who proposed, whatever roles
 * they hold; this screen does not offer it either, and says why, so nobody
 * spends a minute wondering where the button went.
 */
export function Approvals() {
  const pending = useProposals('pending');
  const recent = useProposals(null);
  const [deciding, setDeciding] = useState<Decision | null>(null);

  const decided = (recent.data ?? []).filter((p) => p.status !== 'pending').slice(0, 20);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Aprobaciones</h1>
          <p>
            Un ingreso lo propone una persona y lo aprueba otra. Hasta entonces no se mueve
            nada; si nadie decide en 24 horas, vence.
          </p>
        </div>
      </div>

      <Card
        title="Por decidir"
        aside={
          pending.data !== undefined && (
            <Badge tone={pending.data.length === 0 ? 'ok' : 'warn'}>
              {pending.data.length === 0 ? 'Nada esperando' : `${pending.data.length} esperando`}
            </Badge>
          )
        }
      >
        {pending.isError ? (
          <div className="card__body">
            <Failure error={pending.error} />
          </div>
        ) : pending.data === undefined ? (
          <Loading what="las propuestas" />
        ) : pending.data.length === 0 ? (
          <Empty>No hay propuestas esperando.</Empty>
        ) : (
          <Proposals items={pending.data} onDecide={setDeciding} />
        )}
      </Card>

      <Card title="Decididas hace poco">
        {recent.data === undefined ? (
          <Loading what="el historial" />
        ) : decided.length === 0 ? (
          <Empty>Todavía no se ha decidido ninguna.</Empty>
        ) : (
          <Proposals items={decided} onDecide={setDeciding} />
        )}
      </Card>

      <DecisionDialog decision={deciding} onClose={() => setDeciding(null)} />
    </>
  );
}

type Decision = { proposal: TreasuryProposal; verdict: 'approve' | 'reject' | 'withdraw' };

function Proposals({
  items,
  onDecide,
}: {
  items: readonly TreasuryProposal[];
  onDecide: (decision: Decision) => void;
}) {
  const scales = useScales();
  const { operator } = useAuth();
  const approve = useCan(Can.treasuryApprove);
  const propose = useCan(Can.treasuryPropose);

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Qué</th>
          <th>Importe</th>
          <th>Destino</th>
          <th>Origen</th>
          <th>Motivo</th>
          <th>Propuso</th>
          <th>Estado</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((p) => {
          const amount = readMoney(p.amount, scales);
          const mine = p.proposedBy === operator?.id;
          return (
            <tr key={p.id}>
              <td>{KINDS[p.kind] ?? p.kind}</td>
              <td className="num">
                {amount ? formatMoney(amount) : `${p.amount.amount} ${p.amount.currency}`}
              </td>
              <td>{p.destination}</td>
              <td className="num">{p.source}</td>
              <td>{p.reason}</td>
              <td>
                {p.proposedByName ?? p.proposedBy}
                <br />
                <small className="muted">
                  <Moment at={p.proposedAt} />
                </small>
              </td>
              <td>
                <Badge tone={STATUS[p.status]?.tone ?? 'quiet'}>
                  {STATUS[p.status]?.label ?? p.status}
                </Badge>
                {p.decidedByName !== null && p.status !== 'pending' && (
                  <>
                    <br />
                    <small className="muted">{p.decidedByName}</small>
                  </>
                )}
                {p.decisionNote !== null && (
                  <>
                    <br />
                    <small className="muted">«{p.decisionNote}»</small>
                  </>
                )}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {p.status === 'pending' && mine && (
                  <>
                    <small className="muted">Tuya: la aprueba otra persona. </small>
                    {propose && (
                      <button type="button" onClick={() => onDecide({ proposal: p, verdict: 'withdraw' })}>
                        Retirar
                      </button>
                    )}
                  </>
                )}
                {p.status === 'pending' && !mine && approve && (
                  <>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => onDecide({ proposal: p, verdict: 'approve' })}
                    >
                      Aprobar
                    </button>{' '}
                    <button type="button" onClick={() => onDecide({ proposal: p, verdict: 'reject' })}>
                      Rechazar
                    </button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const KINDS: Readonly<Record<string, string>> = {
  credit: 'Ingreso',
  mint: 'Emisión E-ISLA',
  burn: 'Retiro E-ISLA',
};

const TITLES = {
  approve: 'Aprobar la propuesta',
  reject: 'Rechazar la propuesta',
  withdraw: 'Retirar tu propuesta',
} as const;

function DecisionDialog({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const decide = useDecideProposal();
  const scales = useScales();
  const formId = useId();
  const [note, setNote] = useState('');
  const [key, setKey] = useState('');

  // One key per opening: pressing again after a timeout is the same approval.
  useEffect(() => {
    if (decision !== null) {
      setNote('');
      setKey(newIdempotencyKey());
      decide.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);

  if (decision === null) return null;

  const { proposal, verdict } = decision;
  const amount = readMoney(proposal.amount, scales);
  const needsNote = verdict === 'reject';
  const complete = !needsNote || note.trim().length >= 4;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || decision === null) return;
    decide.mutate(
      { id: proposal.id, verdict, key, ...(note.trim() !== '' ? { note: note.trim() } : {}) },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title={TITLES[verdict]}>
      <form id={formId} onSubmit={submit}>
        <div className="dialog__body">
          {decide.isError && <Failure error={decide.error} />}
          <p style={{ marginTop: 0 }}>
            <strong className="num">
              {amount ? formatMoney(amount) : `${proposal.amount.amount} ${proposal.amount.currency}`}
            </strong>{' '}
            al {proposal.destination}, desde <span className="num">{proposal.source}</span>.
            <br />
            <span className="muted">«{proposal.reason}» — {proposal.proposedByName ?? proposal.proposedBy}</span>
          </p>
          {verdict === 'approve' && (
            <Note tone="warn">
              Al aprobar se escribe el asiento: el dinero entra en el libro con tu nombre al lado
              del de quien lo propuso. Compruébalo contra el extracto antes.
            </Note>
          )}
          {verdict !== 'withdraw' && (
            <Field
              label={needsNote ? 'Motivo del rechazo' : 'Nota (opcional)'}
              {...(needsNote ? { hint: 'Quien lo propuso lo leerá para corregirlo.' } : {})}
            >
              {(parts) => (
                <input {...parts} value={note} onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
          )}
        </div>
        <div className="dialog__foot">
          <button type="button" onClick={onClose} disabled={decide.isPending}>
            Cancelar
          </button>
          <button
            type="submit"
            className={verdict === 'approve' ? 'primary' : undefined}
            disabled={!complete || decide.isPending}
          >
            {decide.isPending
              ? 'Enviando…'
              : verdict === 'approve'
                ? 'Aprobar y asentar'
                : verdict === 'reject'
                  ? 'Rechazar'
                  : 'Retirar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
