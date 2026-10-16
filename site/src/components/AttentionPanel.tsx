import type { Alert } from '../lib/kpis';

export function AttentionPanel({ items }: { items: Alert[] }) {
  return (
    <div className="card panel side attention">
      <h2>Needs attention</h2>
      {items.length === 0 ? (
        <p>Every measure with a target met it this month.</p>
      ) : (
        <ul>
          {items.map((a, i) => (
            <li key={i}>
              <span className="mark" aria-hidden="true" />
              <div>
                <div className="strong">{a.title}</div>
                {a.body && <div className="sub">{a.body}</div>}
                {a.source === 'note' && <div className="tag">Manager note</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
