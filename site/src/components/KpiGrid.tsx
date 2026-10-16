import { type Kpi, STATUS_LABEL } from '../lib/kpis';

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <section aria-label="Key performance indicators" className="kpi-grid">
      {kpis.map((k) => (
        <article key={k.id} className="card kpi" title={k.help}>
          <div className="kpi-head">
            <h3>{k.label}</h3>
            <span className={`pill status-${k.status}`}>{STATUS_LABEL[k.status]}</span>
          </div>
          <div className="kpi-value">{k.display}</div>
          <div className="kpi-foot">
            <span className={k.deltaGood == null ? 'delta' : k.deltaGood ? 'delta good' : 'delta bad'}>{k.deltaText}</span>
            <span>{k.targetDisplay ? `Target ${k.targetDisplay}` : 'No target set'}</span>
          </div>
        </article>
      ))}
    </section>
  );
}
