import type { Ytd } from '../lib/kpis';

export function YtdPanel({ ytd, throughLabel }: { ytd: Ytd; throughLabel: string }) {
  const elapsed = Math.round(ytd.elapsedPct);
  return (
    <div className="card panel side">
      <h2>Year-to-date vs annual target</h2>
      {ytd.items.map((item) => {
        const width = Math.min(100, item.pctOfTarget ?? 0);
        // Spend running ahead of the calendar, or results running behind it, is flagged.
        const behind = item.pctOfTarget != null && (item.isSpend ? item.pctOfTarget > ytd.elapsedPct + 2 : item.pctOfTarget < ytd.elapsedPct - 2);
        return (
          <div key={item.label} className="progress">
            <div className="progress-head">
              <span className="strong">{item.label}</span>
              <span className="muted">{item.text}</span>
            </div>
            <div className="bar-track" role="img" aria-label={`${item.label}: ${item.text}`}>
              <div className={behind ? 'bar-fill flag' : 'bar-fill'} style={{ width: `${width}%` }} />
              <div className="bar-elapsed" style={{ left: `${ytd.elapsedPct}%` }} />
            </div>
          </div>
        );
      })}
      <p className="muted small">
        January to {throughLabel}: {elapsed}% of the year elapsed (marker on each bar).
        {ytd.monthsReported < ytd.monthsExpected && ` Only ${ytd.monthsReported} of ${ytd.monthsExpected} months are in the workbook.`}
      </p>
    </div>
  );
}
