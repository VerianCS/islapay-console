import { useEffect, useState } from 'react';
import { useAccountLookup, useChangeStanding, useUserNotifications } from '../api/queries';
import type { AccountStanding } from '../api/queries';
import { Can, useCan } from '../auth/AuthProvider';
import { Badge, Card, Empty, Failure, Field, Loading, Modal, Moment, Note } from '../ui/components';

const LEVELS: Readonly<Record<number, string>> = {
  0: 'Sin verificar — el teléfono no está probado',
  1: 'Teléfono probado',
  2: 'Identidad comprobada',
};

/**
 * One customer, by the address they give on the phone.
 *
 * Support looks; compliance acts. A freeze stops the account moving money on
 * its very next request, in every module; it does not stop the person signing
 * in and seeing their balance, which is what they will call about.
 */
export function Accounts() {
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');
  const account = useAccountLookup(asked);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setAsked(typed.trim());
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cuentas</h1>
          <p>
            Buscar a un cliente, ver su nivel y si está congelado. Cada cambio pide un motivo y
            queda en la auditoría con él.
          </p>
        </div>
      </div>

      <Card title="Buscar por correo">
        <form className="card__body" onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
            <Field label="Correo">
              {(parts) => (
                <input
                  {...parts}
                  type="email"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="cliente@correo.cu"
                />
              )}
            </Field>
            <button type="submit" className="primary" disabled={typed.trim() === ''}>
              Buscar
            </button>
          </div>
        </form>
      </Card>

      {asked === '' ? null : account.isError ? (
        <Card>
          <div className="card__body">
            <Failure error={account.error} />
          </div>
        </Card>
      ) : account.data === undefined ? (
        <Loading what="la cuenta" />
      ) : (
        <>
          <Standing account={account.data} />
          <Told userId={account.data.userId} />
        </>
      )}
    </>
  );
}

type Change = 'freeze' | 'unfreeze' | 'level';

function Standing({ account }: { account: AccountStanding }) {
  const act = useCan(Can.complianceAct);
  const [changing, setChanging] = useState<Change | null>(null);

  return (
    <Card
      title={account.name}
      aside={
        account.frozen ? <Badge tone="alarm">Congelada</Badge> : <Badge tone="ok">Activa</Badge>
      }
    >
      <div className="card__body">
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0 }}>
          <dt className="muted">Correo</dt>
          <dd style={{ margin: 0 }}>{account.email}</dd>
          <dt className="muted">Teléfono</dt>
          <dd style={{ margin: 0 }} className="num">
            {account.phone ?? '—'} {account.phoneVerified ? '(probado)' : '(sin probar)'}
          </dd>
          <dt className="muted">Nivel</dt>
          <dd style={{ margin: 0 }}>
            {account.level} · {LEVELS[account.level] ?? ''}
          </dd>
          <dt className="muted">Máximo por movimiento</dt>
          <dd style={{ margin: 0 }} className="num">
            {account.maxPerMovement}
          </dd>
          {account.frozen && (
            <>
              <dt className="muted">Congelada</dt>
              <dd style={{ margin: 0 }}>
                «{account.frozenReason}» — {account.frozenBy}
                {account.frozenAt && (
                  <>
                    , <Moment at={account.frozenAt} />
                  </>
                )}
              </dd>
            </>
          )}
          <dt className="muted">Id</dt>
          <dd style={{ margin: 0, fontSize: 12 }} className="num">
            {account.userId}
          </dd>
        </dl>

        {act ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {account.frozen ? (
              <button type="button" onClick={() => setChanging('unfreeze')}>
                Descongelar
              </button>
            ) : (
              <button type="button" onClick={() => setChanging('freeze')}>
                Congelar
              </button>
            )}
            <button type="button" onClick={() => setChanging('level')} disabled={!account.phoneVerified}>
              Cambiar nivel
            </button>
          </div>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>
            Sólo cumplimiento puede congelar o cambiar el nivel.
          </p>
        )}
      </div>

      <ChangeDialog account={account} change={changing} onClose={() => setChanging(null)} />
    </Card>
  );
}

const TITLES: Readonly<Record<Change, string>> = {
  freeze: 'Congelar la cuenta',
  unfreeze: 'Descongelar la cuenta',
  level: 'Cambiar el nivel',
};

function ChangeDialog({
  account,
  change,
  onClose,
}: {
  account: AccountStanding;
  change: Change | null;
  onClose: () => void;
}) {
  const standing = useChangeStanding();
  const [reason, setReason] = useState('');
  const [level, setLevel] = useState(account.level === 2 ? 1 : 2);

  useEffect(() => {
    if (change !== null) {
      setReason('');
      setLevel(account.level === 2 ? 1 : 2);
      standing.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change]);

  if (change === null) return null;
  const complete = reason.trim().length >= 4;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || change === null) return;
    const request =
      change === 'level'
        ? { id: account.userId, change, level, reason: reason.trim() }
        : { id: account.userId, change, reason: reason.trim() };
    standing.mutate(request, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={TITLES[change]} subtitle={account.email}>
      <form onSubmit={submit}>
        <div className="dialog__body">
          {standing.isError && <Failure error={standing.error} />}
          {change === 'freeze' && (
            <Note tone="warn">
              Desde la próxima petición no podrá enviar, vender, comprar ni pedir direcciones de
              depósito. Podrá entrar y ver su saldo.
            </Note>
          )}
          {change === 'level' && (
            <Field label="Nivel">
              {(parts) => (
                <select {...parts} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                  <option value={1}>1 · {LEVELS[1]}</option>
                  <option value={2}>2 · {LEVELS[2]}</option>
                </select>
              )}
            </Field>
          )}
          <Field label="Motivo" hint="Lo leerá quien revise la auditoría, y quizá el cliente.">
            {(parts) => <input {...parts} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
        <div className="dialog__foot">
          <button type="button" onClick={onClose} disabled={standing.isPending}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!complete || standing.isPending}>
            {standing.isPending ? 'Guardando…' : TITLES[change]}
          </button>
        </div>
      </form>
    </Modal>
  );
}


/**
 * What the customer was told, newest first — the notifications in their app.
 *
 * For the call that begins «nunca me avisaron»: whether the notice was
 * written, when, in what words, and whether they opened it.
 */
function Told({ userId }: { userId: string }) {
  const told = useUserNotifications(userId);

  return (
    <Card title="Notificaciones que recibió">
      {told.isError ? (
        <div className="card__body">
          <Failure error={told.error} />
        </div>
      ) : told.data === undefined ? (
        <Loading what="las notificaciones" />
      ) : told.data.items.length === 0 ? (
        <Empty>Ninguna todavía.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Notificación</th>
              <th>Leída</th>
            </tr>
          </thead>
          <tbody>
            {told.data.items.map((n) => (
              <tr key={n.id}>
                <td>
                  <Moment at={n.createdAt} />
                </td>
                <td>
                  <strong>{n.title}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {n.body}
                  </div>
                </td>
                <td>{n.readAt ? <Moment at={n.readAt} /> : <Badge tone="quiet">No</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
