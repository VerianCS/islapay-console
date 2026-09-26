import { useState } from 'react';
import { useBroadcasts, useSendBroadcast } from '../api/queries';
import type { Broadcast, BroadcastRequest } from '../api/queries';
import { Badge, Card, Empty, Failure, Field, Loading, Modal, Moment, Note } from '../ui/components';

const MAX_TITLE = 80;
const MAX_BODY = 500;

/**
 * Telling customers something, on their phones.
 *
 * To everybody, or to one account. An announcement to everybody reaches every
 * lock screen that takes news, and it cannot be taken back once sent — so the
 * screen shows it the way a phone will before it goes, and asks once more.
 * Every announcement is in the audit log with its words.
 */
export function Announcements() {
  const broadcasts = useBroadcasts();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Avisos</h1>
          <p>
            Un mensaje de IslaPay a todos los clientes —mantenimiento, novedades— o a una cuenta. Llega
            a la lista de notificaciones de la app y, por push, a los teléfonos que lo aceptan.
          </p>
        </div>
      </div>

      <Compose />

      <Card title="Enviados">
        {broadcasts.isError ? (
          <div className="card__body">
            <Failure error={broadcasts.error} />
          </div>
        ) : broadcasts.data === undefined ? (
          <Loading what="los avisos" />
        ) : broadcasts.data.length === 0 ? (
          <Empty>Todavía no se ha enviado ningún aviso.</Empty>
        ) : (
          <History items={broadcasts.data} />
        )}
      </Card>
    </>
  );
}

function Compose() {
  const send = useSendBroadcast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [everybody, setEverybody] = useState(true);
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('14');
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<Broadcast | null>(null);

  const daysNumber = Number(days);
  const daysError =
    everybody && (!Number.isInteger(daysNumber) || daysNumber < 1 || daysNumber > 90)
      ? 'Entre 1 y 90 días.'
      : undefined;
  const emailError =
    !everybody && email.trim() !== '' && !/^[^@\s]+@[^@\s]+$/.test(email.trim())
      ? 'No parece un correo.'
      : undefined;

  const complete =
    title.trim().length > 0 &&
    title.trim().length <= MAX_TITLE &&
    body.trim().length > 0 &&
    body.trim().length <= MAX_BODY &&
    daysError === undefined &&
    (everybody || (email.trim() !== '' && emailError === undefined));

  function request(): BroadcastRequest {
    return everybody
      ? { title: title.trim(), body: body.trim(), days: daysNumber }
      : { title: title.trim(), body: body.trim(), email: email.trim().toLowerCase() };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setSent(null);
    setConfirming(true);
  }

  function confirm() {
    send.mutate(request(), {
      onSuccess: (done) => {
        setSent(done);
        setConfirming(false);
        setTitle('');
        setBody('');
        setEmail('');
      },
      onError: () => setConfirming(false),
    });
  }

  return (
    <Card title="Nuevo aviso">
      <form className="card__body" onSubmit={submit}>
        {send.isError && <Failure error={send.error} />}
        {sent && (
          <Note tone="ok">
            Enviado {sent.audience === 'all' ? 'a todos' : `a ${sent.audience}`}. Push en cola para{' '}
            {sent.devices} {sent.devices === 1 ? 'dispositivo' : 'dispositivos'}.
          </Note>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24 }}>
          <div>
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
              <legend className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                A quién
              </legend>
              <label style={{ marginRight: 16 }}>
                <input type="radio" name="audience" checked={everybody} onChange={() => setEverybody(true)} />{' '}
                Todos los clientes
              </label>
              <label>
                <input type="radio" name="audience" checked={!everybody} onChange={() => setEverybody(false)} />{' '}
                Una cuenta
              </label>
            </fieldset>

            {everybody ? (
              <Field
                label="Días en la lista"
                error={daysError}
                hint="Después deja de aparecer en la app. Quien abra su cuenta mientras tanto también lo verá."
              >
                {(parts) => (
                  <input
                    {...parts}
                    inputMode="numeric"
                    className="num"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    style={{ maxWidth: 120, display: 'block' }}
                  />
                )}
              </Field>
            ) : (
              <Field
                label="Correo de la cuenta"
                error={emailError}
                hint="Le llega aunque haya apagado las novedades: es un mensaje sobre su cuenta."
              >
                {(parts) => (
                  <input
                    {...parts}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cliente@correo.cu"
                  />
                )}
              </Field>
            )}

            <Field label="Título" hint={`${title.trim().length}/${MAX_TITLE}`}>
              {(parts) => (
                <input
                  {...parts}
                  maxLength={MAX_TITLE}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Mantenimiento el domingo"
                />
              )}
            </Field>

            <Field label="Mensaje" hint={`${body.trim().length}/${MAX_BODY}`}>
              {(parts) => (
                <textarea
                  {...parts}
                  rows={4}
                  maxLength={MAX_BODY}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="El domingo de 2:00 a 3:00 la app puede no responder."
                />
              )}
            </Field>
          </div>

          <Preview title={title} body={body} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="submit" className="primary" disabled={!complete || send.isPending}>
            Revisar y enviar
          </button>
        </div>
      </form>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={everybody ? '¿Enviar a todos los clientes?' : `¿Enviar a ${email.trim()}?`}
      >
        <div className="dialog__body">
          {everybody ? (
            <Note tone="warn">
              Llega al teléfono de todos los clientes que aceptan novedades y aparece en la app de todos
              durante {daysNumber} {daysNumber === 1 ? 'día' : 'días'}. Un aviso enviado no se puede retirar.
            </Note>
          ) : (
            <Note tone="warn">Llega a su teléfono aunque haya apagado las notificaciones.</Note>
          )}
          <Preview title={title} body={body} />
        </div>
        <div className="dialog__foot">
          <button type="button" onClick={() => setConfirming(false)} disabled={send.isPending}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={confirm} disabled={send.isPending}>
            {send.isPending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </Modal>
    </Card>
  );
}

/** Roughly what a phone shows: the app's name, the title, two lines of text. */
function Preview({ title, body }: { title: string; body: string }) {
  return (
    <figure aria-label="Vista previa" style={{ margin: 0 }}>
      <figcaption className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
        Así se verá
      </figcaption>
      <div
        style={{
          borderRadius: 16,
          padding: '12px 14px',
          background: 'var(--surface-2, #f2f4f8)',
          boxShadow: '0 1px 3px rgba(0,0,0,.12)',
        }}
      >
        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
          IslaPay · ahora
        </div>
        <strong style={{ display: 'block', fontSize: 14 }}>{title.trim() || 'Título del aviso'}</strong>
        <span
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontSize: 13,
          }}
        >
          {body.trim() || 'El mensaje, tal como lo escribas.'}
        </span>
      </div>
    </figure>
  );
}

function History({ items }: { items: readonly Broadcast[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Cuándo</th>
          <th>A quién</th>
          <th>Aviso</th>
          <th>Push</th>
          <th>Quién</th>
          <th>Hasta</th>
        </tr>
      </thead>
      <tbody>
        {items.map((b) => (
          <tr key={b.id}>
            <td>
              <Moment at={b.sentAt} />
            </td>
            <td>{b.audience === 'all' ? <Badge tone="quiet">Todos</Badge> : b.audience}</td>
            <td>
              <strong>{b.title}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {b.body}
              </div>
            </td>
            <td className="num">{b.devices}</td>
            <td>{b.sentBy}</td>
            <td>{b.expiresAt ? <Moment at={b.expiresAt} /> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
