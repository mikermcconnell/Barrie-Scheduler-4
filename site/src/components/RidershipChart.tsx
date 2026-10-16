import type { TrendPoint } from '../lib/kpis';

const W = 720;
const H = 250;
const LEFT = 48;
const RIGHT = 700;
const TOP = 24;
const BOTTOM = 210;

function niceStep(range: number, ticks: number) {
  const raw = range / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = [1, 2, 2.5, 5, 10].find((s) => s * pow >= raw) ?? 10;
  return unit * pow;
}

const shortCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function path(points: TrendPoint[], pick: (p: TrendPoint) => number | null, x: (i: number) => number, y: (v: number) => number) {
  // Gaps in the data break the line rather than drawing through missing months.
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    const v = pick(p);
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

export function RidershipChart({ points, latestLabel }: { points: TrendPoint[]; latestLabel: string }) {
  const values = points.flatMap((p) => [p.current, p.prior]).filter((v): v is number => v != null);
  if (!values.length) return <p className="muted">No boardings recorded for these months.</p>;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min *= 0.9; max = max * 1.1 + 1; }
  const step = niceStep(max - min, 4);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);

  const x = (i: number) => LEFT + (i * (RIGHT - LEFT)) / (points.length - 1);
  const y = (v: number) => BOTTOM - ((v - lo) / (hi - lo)) * (BOTTOM - TOP);
  const last = points[points.length - 1];
  const hasPrior = points.some((p) => p.prior != null);

  const first = points.find((p) => p.current != null);
  const summary = first && last.current != null
    ? `Monthly boardings went from ${shortCount(first.current!)} in ${first.label} to ${shortCount(last.current)} in ${last.label}.`
    : 'Monthly boardings for the last 12 months.';

  return (
    <>
      <div className="legend">
        <span><i className="swatch line" />Last 12 months</span>
        {hasPrior && <span><i className="swatch dashed" />Year before</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary} className="chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={RIGHT} y1={y(t)} y2={y(t)} className="grid" />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" className="axis">{shortCount(t)}</text>
          </g>
        ))}
        {hasPrior && <path d={path(points, (p) => p.prior, x, y)} className="series prior" />}
        <path d={path(points, (p) => p.current, x, y)} className="series current" />
        {last.current != null && (
          <>
            <circle cx={x(points.length - 1)} cy={y(last.current)} r={5} className="marker" />
            <text x={x(points.length - 1) - 10} y={y(last.current) - 10} textAnchor="end" className="callout">{latestLabel}</text>
          </>
        )}
        {points.map((p, i) => (
          <text key={p.month} x={x(i)} y={BOTTOM + 26} textAnchor="middle" className="axis">{p.label}</text>
        ))}
      </svg>
    </>
  );
}
