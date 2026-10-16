import { useState } from 'react';
import { type RouteSummary, STATUS_LABEL } from '../lib/kpis';

const TOP = 5;

export function RoutesTable({ routes }: { routes: RouteSummary[] }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="card panel main">
      <div className="panel-head">
        <h2>
          <span className={showAll ? '' : 'print-only'}>All routes this month</span>
          {!showAll && <span className="no-print">Busiest routes this month</span>}
        </h2>
        {routes.length > TOP && (
          <button type="button" className="btn ghost no-print" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show top ${TOP}` : `Show all ${routes.length}`}
          </button>
        )}
      </div>
      {routes.length === 0 ? (
        <p className="muted">No rows for this month on the "Routes" sheet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col" className="num">Boardings</th>
                <th scope="col" className="num">vs last year</th>
                <th scope="col" className="num">Boardings / rev. hr</th>
                <th scope="col" className="num">On-time</th>
              </tr>
            </thead>
            <tbody>
              {/* Every route is rendered so the printed report lists them all. */}
              {routes.map((r, i) => (
                <tr key={r.route} className={!showAll && i >= TOP ? 'screen-hidden' : undefined}>
                  <td><span className="route-chip">{r.route}</span>{r.routeName}</td>
                  <td className="num strong">{r.boardingsDisplay}</td>
                  <td className={`num ${r.yoyGood == null ? '' : r.yoyGood ? 'good' : 'bad'}`}>{r.yoyText}</td>
                  <td className="num">{r.bphDisplay}</td>
                  <td className="num">
                    {r.otpDisplay}
                    {(r.otpStatus === 'below' || r.otpStatus === 'watch') && (
                      <span className={`pill tiny status-${r.otpStatus}`}>{STATUS_LABEL[r.otpStatus]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
