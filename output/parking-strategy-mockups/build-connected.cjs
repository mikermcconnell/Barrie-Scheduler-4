const fs = require('fs');
const path = require('path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { parseParkingLocoMobiWorkbooks } = require('../../utils/parking/parkingLocoMobiParser.ts');
const names = ['Locomobi Payment Data_WORLDSTREAM_JAN_1_to_DEC_31_2024.xlsx', 'Locomobi Payment Data_WORLDSTREAM_JAN_1_to_OCT_31_2025.xlsx', 'Locomobi Payment Data_WORLDSTREAM_NOV_1_to_NOV_11_2025.xls'];
const parsed = parseParkingLocoMobiWorkbooks(names.map(fileName => ({ fileName, buffer: fs.readFileSync(path.join('D:/', fileName)) })));
// Only anonymous aggregate cells leave the parser. No raw payment identifiers are embedded.
const cells = new Map();
for (const r of parsed.rows) {
  const key = [r.domain, r.meterId, r.activityMonth].join('|');
  const cell = cells.get(key) || { domain: r.domain, meter: r.meterId, label: r.locationLabel, month: r.activityMonth, count: 0, cents: 0, zero: 0, hours: Array(24).fill(0) };
  cell.count++; cell.cents += Math.round(r.reportedAmount * 100); cell.zero += Number(r.reportedAmount === 0); cell.hours[Math.floor(r.activityMinutes / 60)]++;
  cells.set(key, cell);
}
const data = { cells: [...cells.values()], reconciliation: parsed.reconciliation, sources: parsed.sourceTables, coverage: parsed.coverage };
const template = fs.readFileSync(path.join(__dirname, 'connected-template.html'), 'utf8');
const html = template.replace('/*EMBED_DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
const target = path.join(__dirname, '04-connected-evidence-board.html');
fs.writeFileSync(target, html);
console.log(JSON.stringify({ target, bytes: Buffer.byteLength(html), records: parsed.reconciliation.acceptedRowCount, amount: parsed.reconciliation.totalReportedAmount }));
