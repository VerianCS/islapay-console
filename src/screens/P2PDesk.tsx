import { useEffect, useId, useState } from 'react';
import { newIdempotencyKey } from '../api/client';
import {
  readMoney,
  useFailTrade,
  useP2PQueue,
  useP2PSearch,
  useScales,
  useSettleTrade,
} from '../api/queries';
import type { P2PQueueItem } from '../api/queries';
import { formatMoney } from '../money/money';
import { Badge, Card, Empty, Failure, Field, Loading, Modal, Note } from '../ui/components';

/**
 * The P2P desk: what waits on a person, and everything else by reference.
 *
 * Before this the operator called the API by hand, which is to say the desk
 * worked for whoever could write a curl command with an idempotency key. The
 * queue is polled, the actions ask for the bank's reference before anything
 * moves, and a buy that expired and was paid late — which the server still
 * accepts — is one search away instead of invisible.
 */
export function P2PDesk() {
  const queue = useP2PQueue();
  const [acting, setActing] = useState<Action | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mesa P2P</h1>
          <p>
            Las ventas esperan a que les mandes los pesos; las compras, a que confirmes que
            llegaron. Nada se mueve sin la referencia del banco, y la lista se actualiza sola.
          </p>
        </div>
      </div>

      <Card
        title="Cola"
        aside={
          queue.data !== undefined && (
            <Badge tone={queue.data.length === 0 ? 'ok' : 'warn'}>
              {queue.data.length === 0 ? 'Nada esperando' : `${queue.data.length} esperando`}
            </Badge>
          )
        }
      >
        {queue.isError ? (
          <div className="card__body">
            <Failure error={queue.error} />
          </div>
        ) : queue.data === undefined ? (
          <Loading what="la cola" />
        ) : queue.data.length === 0 ? (
          <Empty>No hay ventas por pagar ni compras por recibir.</Empty>
        ) : (
          <Trades items={queue.data} onAct={setActing} showStatus={false} />
        )}
      </Card>

      <Search onAct={setActing} />

      <SettleDialog action={acting} onClose={() => setActing(null)} />
    </>
  );
}

// ------------------------------------------------------------------ search

const STATUSES = [
  { value: '', label: 'Cualquier estado' },
  { value: 'expired', label: 'Vencidas' },
  { value: 'awaiting_payment', label: 'Esperando los pesos del cliente' },
  { value: 'awaiting_payout', label: 'Esperando que paguemos' },
  { value: 'completed', label: 'Completadas' },
  { value: 'refunded', label: 'Devueltas' },
  { value: 'cancelled', label: 'Canceladas' },
] as const;

function Search({ onAct }: { onAct: (action: Action) => void }) {
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState('');
  const [asked, setAsked] = useState<{ reference: string; status: string }>({
    reference: '',
    status: '',
  });
  const results = useP2PSearch(asked.reference, asked.status);
  const searched = asked.reference !== '' || asked.status !== '';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAsked({ reference: typed.trim(), status });
  }

  return (
    <Card title="Buscar operaciones">
      <form className="card__body" onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>
          La cola sólo enseña lo abierto. Una compra vencida que el cliente pagó tarde se
          encuentra aquí por la referencia que escribió en la transferencia, con o sin guion.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <Field label="Referencia">
            {(parts) => (
              <input
                {...parts}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="K7QM-2X9A"
                className="num"
              />
            )}
          </Field>
          <Field label="Estado">
            {(parts) => (
              <select {...parts} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" className="primary" disabled={typed.trim() === '' && status === ''}>
            Buscar
          </button>
        </div>
      </form>

      {searched &&
        (results.isError ? (
          <div className="card__body">
            <Failure error={results.error} />
          </div>
        ) : results.data === undefined ? (
          <Loading what="las operaciones" />
        ) : results.data.length === 0 ? (
          <Empty>Ninguna operación coincide.</Empty>
        ) : (
          <Trades items={results.data} onAct={onAct} showStatus />
        ))}
    </Card>
  );
}

// ------------------------------------------------------------------- table

const STATUS_WORDS: Readonly<Record<string, [string, 'ok' | 'warn' | 'alarm' | 'quiet']>> = {
  awaiting_payout: ['Por pagar', 'warn'],
  awaiting_payment: ['Esperando pesos', 'warn'],
  pending: ['Comprometiendo', 'quiet'],
  settling: ['Liquidando', 'quiet'],
  completed: ['Completada', 'ok'],
  refunded: ['Devuelta', 'quiet'],
  expired: ['Vencida', 'alarm'],
  cancelled: ['Cancelada', 'quiet'],
};

function Trades({
  items,
  onAct,
  showStatus,
}: {
  items: readonly P2PQueueItem[];
  onAct: (action: Action) => void;
  showStatus: boolean;
}) {
  const scales = useScales();

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Cliente</th>
            <th className="right">Saldo</th>
            <th className="right">Pesos</th>
            <th>Referencia</th>
            <th>Destino</th>
            {showStatus && <th>Estado</th>}
            <th>{showStatus ? 'Abierta' : 'Espera'}</th>
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const sell = t.side === 'sell';
            const [word, tone] = STATUS_WORDS[t.status] ?? [t.status, 'quiet'];
            return (
              <tr key={t.id}>
                <td>
                  <Badge tone={sell ? 'warn' : 'ok'}>{sell ? 'Venta' : 'Compra'}</Badge>
                </td>
                <td>{t.userName}</td>
                <td className="num right">{amount(t.amount, scales)}</td>
                <td className="num right">
                  <strong>{amount(t.local, scales)}</strong>
                </td>
                <td className="num">{t.reference}</td>
                <td className="num">{sell ? (t.payoutTo ?? '—') : '—'}</td>
                {showStatus && (
                  <td>
                    <Badge tone={tone}>{word}</Badge>
                    {t.operatorReference && (
                      <div className="muted num" style={{ fontSize: 12 }}>
                        {t.operatorReference}
                      </div>
                    )}
                    {t.failureReason && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {t.failureReason}
                      </div>
                    )}
                  </td>
                )}
                <td>
                  {showStatus ? (
                    <time dateTime={t.createdAt} className="num">
                      {new Date(t.createdAt).toLocaleString('es-CU', { dateStyle: 'short', timeStyle: 'short' })}
                    </time>
                  ) : (
                    // How long, which is the queue's question; when exactly
                    // is one hover away.
                    <span title={new Date(t.createdAt).toLocaleString('es-CU')}>{waited(t.createdAt)}</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {sell && t.status === 'awaiting_payout' && (
                    <>
                      <button type="button" className="primary" onClick={() => onAct({ kind: 'paid', trade: t })}>
                        Pagado
                      </button>{' '}
                      <button type="button" onClick={() => onAct({ kind: 'failed', trade: t })}>
                        Falló
                      </button>
                    </>
                  )}
                  {!sell && (t.status === 'awaiting_payment' || t.status === 'expired') && (
                    <button type="button" className="primary" onClick={() => onAct({ kind: 'received', trade: t })}>
                      Recibido
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function amount(wire: P2PQueueItem['amount'], scales: ReturnType<typeof useScales>): string {
  const money = readMoney(wire, scales);
  return money !== null ? formatMoney(money) : `${wire.amount} ${wire.currency}`;
}

/** How long somebody has been waiting, the way a person says it. */
export function waited(since: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `hace ${hours} h` : `hace ${hours} h ${rest} min`;
}

// ------------------------------------------------------------------ settle

export type Action =
  | { kind: 'paid'; trade: P2PQueueItem }
  | { kind: 'received'; trade: P2PQueueItem }
  | { kind: 'failed'; trade: P2PQueueItem };

/**
 * Asks for what the server needs before anything moves.
 *
 * The bank's reference for a settlement and a reason for a failure: without
 * the first a dispute six weeks later has nothing to check against, and the
 * second is shown to the customer as written. The idempotency key is minted
 * when the dialog opens, so pressing again after a timeout asks the same
 * question rather than paying twice.
 */
function SettleDialog({ action, onClose }: { action: Action | null; onClose: () => void }) {
  const scales = useScales();
  const settle = useSettleTrade();
  const fail = useFailTrade();
  const formId = useId();
  const [text, setText] = useState('');
  const [key, setKey] = useState(() => newIdempotencyKey());

  useEffect(() => {
    setText('');
    setKey(newIdempotencyKey());
    settle.reset();
    fail.reset();
    // Reset when a different action opens; the mutations are stable objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (action === null) return <Modal open={false} onClose={onClose} title="" children={null} />;

  const t = action.trade;
  const local = amount(t.local, scales);
  const busy = settle.isPending || fail.isPending;
  const error = settle.error ?? fail.error;
  const failing = action.kind === 'failed';
  const valid = failing ? text.trim().length >= 4 : text.trim().length > 0;

  const title =
    action.kind === 'paid'
      ? 'Marcar la venta como pagada'
      : action.kind === 'received'
        ? 'Marcar la compra como recibida'
        : 'La venta no se pudo pagar';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || action === null) return;

    const done = { onSuccess: onClose };
    if (action.kind === 'failed') {
      fail.mutate({ id: t.id, reason: text.trim(), key }, done);
    } else {
      settle.mutate({ id: t.id, action: action.kind, reference: text.trim(), key }, done);
    }
  }

  return (
    <Modal open onClose={onClose} title={title} subtitle={`${t.userName} · ${t.reference}`}>
      <form id={formId} onSubmit={submit}>
        <div className="dialog__body">
          {error !== null && <Failure error={error} />}

          {action.kind === 'paid' && (
            <Note tone="warn">
              Envía <strong>{local}</strong> a <strong className="num">{t.payoutTo ?? '—'}</strong> y
              escribe aquí la referencia que te dio el banco.
            </Note>
          )}
          {action.kind === 'received' && (
            <Note tone={t.status === 'expired' ? 'warn' : 'ok'}>
              Confirma que llegaron <strong>{local}</strong> con la referencia{' '}
              <strong className="num">{t.reference}</strong>.
              {t.status === 'expired' &&
                ' La compra venció, pero si los pesos llegaron se acredita igual: rechazarla dejaría a IslaPay con dinero que no puede explicar.'}
            </Note>
          )}
          {failing && (
            <Note tone="warn">
              Se le devuelve el saldo al cliente. El motivo lo lee él, tal como lo escribas.
            </Note>
          )}

          <Field
            label={failing ? 'Motivo, para el cliente' : 'Referencia del banco'}
            hint={
              failing
                ? 'Por ejemplo: «El teléfono no está registrado en Transfermóvil.»'
                : 'La del comprobante de Transfermóvil o del banco.'
            }
          >
            {(parts) => (
              <input
                {...parts}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={failing ? undefined : 'num'}
                autoFocus
              />
            )}
          </Field>
        </div>

        <div className="dialog__foot">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!valid || busy}>
            {busy
              ? 'Enviando…'
              : action.kind === 'paid'
                ? 'Confirmar pago'
                : action.kind === 'received'
                  ? 'Acreditar al cliente'
                  : 'Devolver el saldo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
