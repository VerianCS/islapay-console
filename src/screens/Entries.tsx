import { Empty, Failure, Loading, Modal, Moment } from '../ui/components';
import { formatMoney } from '../money/money';
import { readMoney, useAccountEntries, useScales } from '../api/queries';

/**
 * One account's history.
 *
 * The metadata is shown rather than hidden behind a chevron, because on a
 * funding credit it is the whole point: who signed for it, why, and against
 * which mirror. A movement without those is exactly what this console exists
 * to make impossible.
 */
export function Entries({
  owner,
  currency,
  onClose,
}: {
  owner: string;
  currency: string;
  onClose: () => void;
}) {
  const page = useAccountEntries(owner, currency);
  const scales = useScales();

  return (
    <Modal open onClose={onClose} title={`${owner} · ${currency}`} subtitle="Lo más reciente primero.">
      <div className="dialog__body" style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {page.isPending ? (
          <Loading what="los movimientos" />
        ) : page.isError ? (
          <Failure error={page.error} />
        ) : page.data.items.length === 0 ? (
          <Empty>Esta cuenta no tiene movimientos.</Empty>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {page.data.items.map((entry) => {
              const money = readMoney(entry.amount, scales);

              return (
                <li
                  key={entry.id}
                  style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <strong style={{ fontSize: 14 }}>{entry.kind}</strong>
                    <span className="muted" style={{ fontSize: 12, flex: 1 }}>
                      <Moment at={entry.occurredAt} />
                    </span>
                    <span className="num">
                      {money === null
                        ? `${entry.amount.amount} ${entry.amount.currency}`
                        : formatMoney(money, { signed: true })}
                    </span>
                  </div>
                  <Metadata metadata={entry.metadata} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="dialog__foot">
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

/** The handful of keys worth reading, in the order somebody asks them. */
const SHOWN = ['reason', 'by', 'source', 'destination'] as const;

const LABEL: Readonly<Record<string, string>> = {
  reason: 'Motivo',
  by: 'Firmado por',
  source: 'Origen',
  destination: 'Destino',
};

function Metadata({ metadata }: { metadata: Record<string, string> }) {
  const shown = SHOWN.filter((key) => metadata[key] !== undefined);
  if (shown.length === 0) return null;

  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '2px 12px',
        margin: '6px 0 0',
        fontSize: 13,
      }}
    >
      {shown.map((key) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt className="muted">{LABEL[key]}</dt>
          <dd style={{ margin: 0 }}>{metadata[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
