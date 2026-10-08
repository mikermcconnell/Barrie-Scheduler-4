// Reproducible candidate authoring; the app validator remains authoritative.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
require.extensions['.ts'] = (module, file) => module._compile(esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file);
const { buildOperationsPlanningInput } = require('../utils/run-cutting/masterAdapter.ts');
const { projectOperationsPlanningInput, restoreOperationsPlanningProposal } = require('../utils/run-cutting/interiorRelief.ts');
const { calculateDailyRunMetrics } = require('../utils/run-cutting/metrics.ts');
const { calculatePieceTransition, resolvePieceBoardingTime } = require('../utils/run-cutting/dutyTransitions.ts');
const { findReliefPoint, getTravelMinutes } = require('../utils/run-cutting/rules.ts');
const { assessOperationsPlanningProposal } = require('../utils/run-cutting/validation.ts');
// --folder <dir> holds outputs; --input <file> uses an app-exported bundle instead of the
// folder's master-source-snapshot.json. Defaults reproduce the September 21 run.
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const folder = path.resolve(arg('--folder') || path.join(__dirname, '../outputs/corrected-run-cut-20260921'));
const inputFile = arg('--input') && path.resolve(arg('--input'));
const write = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2));
const snapshot = inputFile ? null : JSON.parse(fs.readFileSync(path.join(folder, 'master-source-snapshot.json'), 'utf8'));
const input = inputFile ? JSON.parse(fs.readFileSync(inputFile, 'utf8'))
  : buildOperationsPlanningInput({ schemaVersion: 2, scenarioId: 'corrected-full-master-2026-09-21', scenarioName: 'Corrected fixed-route run cut, original Master sources', exportedAt: snapshot.retrievedAt, pinnedSchedules: snapshot.schedules });
if (input.kind !== 'operations-planning-input' || input.schemaVersion !== 2) throw new Error('Expected an operations-planning-input schema-v2 bundle.');
const unitInput = projectOperationsPlanningInput(input);
const rules = unitInput.ruleProfile;
const map = new Map(unitInput.trips.map(t => [t.id, t]));
const blockMap = new Map(unitInput.blockAudits.map(b => [b.vehicleBlockKey, b]));
const same = (a,b) => (findReliefPoint(rules,a)?.id || a.toLowerCase()) === (findReliefPoint(rules,b)?.id || b.toLowerCase());
const slim = pieces => { const blocks = [...new Set(pieces.map(p=>p.blockId))].map(id=>blockMap.get(id));return {...unitInput,blockAudits:blocks,trips:blocks.flatMap(b=>b.tripIds.map(id=>map.get(id)))}; };
const metricsFor = pieces => calculateDailyRunMetrics(slim(pieces), { id:'candidate',runNumber:'candidate',dayType:map.get(pieces[0].tripIds[0]).dayType,pieces });
const cabsFor = pieces => pieces.flatMap(piece => {
  const b=blockMap.get(piece.blockId),first=map.get(piece.tripIds[0]),last=map.get(piece.tripIds.at(-1)), intervals=[];
  if(b.tripIds[0]!==first.id){const travel=getTravelMinutes(rules,'Garage',piece.startReliefPoint);if(travel>0)intervals.push({start:first.startTime-travel,end:first.startTime});}
  if(b.tripIds.at(-1)!==last.id){const travel=getTravelMinutes(rules,piece.endReliefPoint,'Garage');if(travel>0)intervals.push({start:last.arrivalTime,end:last.arrivalTime+travel});}
  return intervals;
});
// --extended widens the bounded search (short meal pieces, cross-route pairs, three-piece
// duties) and keeps only candidates without a run-level contractual or integrity finding
// from the app validator. Rule values are never relaxed.
const extended = process.argv.includes('--extended');
const search = extended ? { minPieceDriving: 20, minPairDriving: 0, pairOptions: 16, crossRoute: true }
  : { minPieceDriving: 110, minPairDriving: 340, pairOptions: 8, crossRoute: false };
// --focus <slack.json> lifts the shortlist caps on vehicle blocks holding work that a
// previous coverage-slack solve could not place (format: { [dayType]: { missing: [unitId] } }).
const focusBlocks = arg('--focus') ? new Set(Object.values(JSON.parse(fs.readFileSync(path.resolve(arg('--focus')), 'utf8')))
  .flatMap(day => day.missing || []).map(id => map.get(id)?.vehicleBlockKey).filter(Boolean)) : new Set();
const inFocus = p => focusBlocks.has(p.piece.blockId);
const runBlockers = (ps, id) => {
  const s = slim(ps);
  const run = { id, runNumber: id, dayType: map.get(ps[0].tripIds[0]).dayType, pieces: ps.map((p, i) => ({ ...p, id: `${id}-piece-${i+1}` })) };
  const a = assessOperationsPlanningProposal(s, { schemaVersion: 1, kind: 'operations-planning-proposal', scenarioId: s.scenarioId,
    sourceManifestFingerprint: s.sourceManifest.fingerprint, codex: { generatedAt: 'candidate-check' }, blockAudits: s.blockAudits,
    dailyRuns: [run], weeklyRosters: [], findings: [], methodNotes: [] });
  // Roster coverage is checked once rosters exist, not per candidate.
  return a.findings.filter(f => f.runId === id && (f.category === 'contractual' || f.category === 'integrity') && f.code !== 'run-roster-coverage-invalid');
};
// Prefilter mirroring the validator's operations-matrix and interline-window checks.
const routeOk = (left, right) => {
  const from = left.piece.routeNumber, to = right.piece.routeNumber, day = left.dayType;
  if (from === to) return true;
  const entry = unitInput.operationsMatrix.entries.find(e => e.fromRoute === from && e.toRoute === to && e.dayTypes.includes(day));
  const rule = rules.interlining.find(r => r.routes.includes(from) && r.routes.includes(to) && r.dayTypes.includes(day));
  return Boolean(entry?.allowed) && right.start - left.end >= entry.minimumTransitionMinutes && (rule?.startMinute === undefined || right.start >= rule.startMinute);
};
function prepare() {
  const integrity=unitInput.blockAudits.flatMap(b=>b.findings).filter(f=>f.category==='integrity');
  const withheldBlocks=unitInput.blockAudits.filter(b=>b.findings.some(f=>f.category==='integrity'));
  const withheldKeys=new Set(withheldBlocks.map(b=>b.vehicleBlockKey));
  write('source-findings.json',integrity);
  write('withheld-blocks.json',withheldBlocks);
  if(integrity.length)console.log(`${integrity.length} unresolved source findings: withholding ${withheldBlocks.length} whole blocks. Output is incomplete and cannot be approved.`);
  if(!inputFile)write('operations-planning-input-v2.json',input);
  write('projected-input.json',unitInput);
  const pieces=[],candidates=[],seen=new Set(),rejected={};
  function add(ps,m,minimumPaid=420) {
    if(m.paidMinutes<minimumPaid||m.paidMinutes>600||m.spreadMinutes>660||m.platformMinutes>rules.maximumDrivingMinutes){if(ps.length>2)rejected['search:paid-or-spread']=(rejected['search:paid-or-spread']||0)+1;return;}
    if(m.longestContinuousPlatformMinutes>(m.isSplit?rules.splitPieceDrivingMaximumMinutes:rules.straightDrivingMaximumMinutes)){if(ps.length>2)rejected['search:continuous-driving']=(rejected['search:continuous-driving']||0)+1;return;}
    const key=ps.map(p=>p.tripIds.join('|')).join(' / ');if(seen.has(key))return;seen.add(key);
    const id=`candidate-${String(candidates.length+1).padStart(6,'0')}`;
    if(extended){const blockers=runBlockers(ps,id);if(blockers.length){for(const f of blockers)rejected[f.code]=(rejected[f.code]||0)+1;return;}}
    const dayType=map.get(ps[0].tripIds[0]).dayType;
    candidates.push({id,dayType,unitIds:ps.flatMap(p=>p.tripIds),pieces:ps,paidMinutes:m.paidMinutes,platformMinutes:m.platformMinutes,
      reportTime:m.reportTime,offTime:m.offTime,spreadMinutes:m.spreadMinutes,isSplit:m.isSplit,cabIntervals:cabsFor(ps),
      cost:10000+Math.abs(m.paidMinutes-490)*15+(m.isSplit?1500:0)+(ps.length>1?50:0)+(ps.length>2?300:0)+(m.paidMinutes<420?5000:0)});
  }
  for(const block of unitInput.blockAudits) {
    if(withheldKeys.has(block.vehicleBlockKey))continue;
    const ts=block.tripIds.map(id=>map.get(id));
    for(let a=0;a<ts.length;a++) {
      if(a>0&&(!findReliefPoint(rules,ts[a].startStop)||!same(ts[a-1].endStop,ts[a].startStop)))continue;
      let driving=0;
      for(let b=a;b<ts.length;b++) {
        if(ts[b].routeNumber!==ts[a].routeNumber)break;
        driving+=ts[b].travelTime;
        if(driving>450||ts[b].arrivalTime-ts[a].startTime>630)break;
        if(b<ts.length-1&&!findReliefPoint(rules,ts[b].endStop))continue;
        const piece={id:`piece-${pieces.length+1}`,blockId:block.vehicleBlockKey,routeNumber:ts[a].routeNumber,
          tripIds:ts.slice(a,b+1).map(t=>t.id),startReliefPoint:ts[a].startStop,endReliefPoint:ts[b].endStop};
        if(resolvePieceBoardingTime(unitInput,piece,map)===null)continue;
        if(getTravelMinutes(rules,'Garage',piece.startReliefPoint)===null||getTravelMinutes(rules,piece.endReliefPoint,'Garage')===null)continue;
        const m=metricsFor([piece]);add([piece],m);
        if(driving>=search.minPieceDriving&&driving<=300&&m.spreadMinutes<=380)pieces.push({piece,dayType:block.dayType,start:ts[a].startTime,end:ts[b].arrivalTime,driving});
      }
    }
    console.log(`Enumerated ${block.blockId} ${block.dayType}: ${candidates.length} singles, ${pieces.length} meal pieces`);
  }
  const groups=new Map();for(const p of pieces){const key=search.crossRoute?p.dayType:p.dayType+':'+p.piece.routeNumber;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  for(const [key,group] of groups){
    group.sort((a,b)=>a.start-b.start);
    let tested=0;
    for(const left of group){
      const options=[];
      for(const right of group){
        if(right.start<left.end+30)continue;if(right.start>left.end+240)break;
        if(left.driving+right.driving<search.minPairDriving||left.driving+right.driving>570)continue;
        if(right.end-left.start>630||!routeOk(left,right))continue;
        const transition=calculatePieceTransition(unitInput,left.piece,right.piece,map);
        if(!transition||!transition.travelResolved||!transition.timingResolved||!transition.travelFits||!transition.breakLocationAllowed)continue;
        // Use standard meals only; unresolved short-break exceptions are not needed.
        if(transition.qualifyingBreakMinutes<rules.standardBreakMinutes.minimum)continue;
        if(!transition.isSplit&&transition.qualifyingBreakMinutes>rules.standardBreakMinutes.maximum)continue;
        if(left.piece.tripIds.some(id=>right.piece.tripIds.includes(id)))continue;
        const approximatePaid=(left.end-left.start)+(right.end-right.start)+35;
        options.push({right,focus:inFocus(left)||inFocus(right),score:Math.abs(approximatePaid-490)+(transition.isSplit?35:0)});
      }
      // Bounded candidate search, not an exhaustive proof of real-world feasibility.
      options.sort((a,b)=>a.score-b.score);
      const shortlist=[...options.slice(0,search.pairOptions),...options.slice(search.pairOptions).filter(o=>o.focus)];
      for(const {right} of shortlist){
        const ps=[left.piece,right.piece],m=metricsFor(ps);tested++;
        if(m.longestContinuousPlatformMinutes>300)continue;
        add(ps,m);
      }
    }
    console.log(`Paired ${key}: tested ${tested}; total candidates ${candidates.length}`);
  }
  if(extended){
    addThreePieceDuties(groups,candidates,add,420);
    // Last resort: a shorter-than-preferred run (best-practice finding only) for work nothing else covers.
    addThreePieceDuties(groups,candidates,add,240);
  }
  const units=unitInput.trips.filter(t=>!withheldKeys.has(t.vehicleBlockKey)).map(t=>({id:t.id,dayType:t.dayType}));
  const covered=new Set(candidates.flatMap(c=>c.unitIds));
  const uncovered=units.filter(u=>!covered.has(u.id));
  const method=extended?'Bounded one- to three-piece candidates, including permitted cross-route transfers; each passed the app run validator; standard meals only; no rule relaxations. Source-invalid blocks withheld, never assigned.'
    :'Bounded single/two-piece same-route candidates; standard meals only; no rule relaxations. Source-invalid blocks withheld, never assigned.';
  if(extended){
    // Compact pool: unit indexes instead of IDs, and piece membership as unit counts.
    const index=new Map(units.map((u,i)=>[u.id,i]));
    const compact=candidates.map(({unitIds,pieces,...c})=>({...c,unitIndexes:unitIds.map(id=>index.get(id)),
      pieces:pieces.map(({tripIds,id:_id,...p})=>({...p,unitCount:tripIds.length}))}));
    fs.writeFileSync(path.join(folder,'candidates.json'),JSON.stringify({units,candidates:compact,rules,uncovered,withheldBlocks:withheldBlocks.map(b=>b.vehicleBlockKey),method}));
  }else write('candidates.json',{units,candidates,rules,uncovered,withheldBlocks:withheldBlocks.map(b=>b.vehicleBlockKey),method});
  console.log(JSON.stringify({units:units.length,candidates:candidates.length,uncovered:uncovered.length,...(extended?{rejectedByValidator:rejected}:{})}));
}
// Three-piece duties only for work that no one- or two-piece candidate covers.
function addThreePieceDuties(groups,candidates,add,minimumPaid){
  const covered=new Set(candidates.flatMap(c=>c.unitIds));
  const fits=(left,right)=>{
    if(right.start<left.end+30||right.start>left.end+240||!routeOk(left,right))return false;
    if(left.piece.tripIds.some(id=>right.piece.tripIds.includes(id)))return false;
    const t=calculatePieceTransition(unitInput,left.piece,right.piece,map);
    return Boolean(t&&t.travelResolved&&t.timingResolved&&t.travelFits&&t.breakLocationAllowed&&t.qualifyingBreakMinutes>=rules.standardBreakMinutes.minimum
      &&(t.isSplit||t.qualifyingBreakMinutes<=rules.standardBreakMinutes.maximum));
  };
  const length=p=>p.end-p.start;
  const score=ps=>Math.abs(ps.reduce((n,p)=>n+length(p),0)+35-490)+(ps.at(-1).end-ps[0].start>630?1e6:0);
  const longest=list=>list.sort((a,b)=>length(b)-length(a)).slice(0,10);
  for(const [key,group] of groups){
    let tested=0;
    // Only pieces whose break window can fit are tested; memoized per piece and direction.
    const byStart=[...group].sort((a,b)=>a.start-b.start),byEnd=[...group].sort((a,b)=>a.end-b.end),memo=new Map();
    const first=(list,value,field)=>{let lo=0,hi=list.length;while(lo<hi){const m=(lo+hi)>>1;if(list[m][field]<value)lo=m+1;else hi=m;}return lo;};
    const near=(p,dir)=>{
      const k=(dir>0?'+':'-')+p.piece.id;if(memo.has(k))return memo.get(k);const out=[];
      if(dir>0)for(let i=first(byStart,p.end+30,'start');i<byStart.length&&byStart[i].start<=p.end+240;i++){if(fits(p,byStart[i]))out.push(byStart[i]);}
      else for(let i=first(byEnd,p.start-240,'end');i<byEnd.length&&byEnd[i].end<=p.start-30;i++){if(fits(byEnd[i],p))out.push(byEnd[i]);}
      memo.set(k,out);return out;
    };
    for(const mid of group){
      const focused=inFocus(mid);
      if(!focused&&mid.piece.tripIds.every(id=>covered.has(id)))continue;
      const before=near(mid,-1),after=near(mid,1),triples=[];
      for(const l of before)for(const r of after)triples.push([l,mid,r]);
      for(const l of longest([...before]))for(const l0 of near(l,-1))triples.push([l0,l,mid]);
      for(const r of longest([...after]))for(const r2 of near(r,1))triples.push([mid,r,r2]);
      if(minimumPaid<420){triples.push([mid]);for(const l of before)triples.push([l,mid]);for(const r of after)triples.push([mid,r]);}
      const ranked=triples.map(ps=>({ps,score:score(ps)})).filter(x=>x.score<1e6).sort((a,b)=>a.score-b.score).slice(0,focused?120:40);
      for(const {ps} of ranked){
        const count=candidates.length;tested++;
        add(ps.map(p=>p.piece),metricsFor(ps.map(p=>p.piece)),minimumPaid);
        if(candidates.length>count)candidates.at(-1).unitIds.forEach(id=>covered.add(id));
      }
    }
    console.log(`${minimumPaid<420?'Short-run fallback':'Three-piece'} ${key}: tested ${tested}; total candidates ${candidates.length}`);
  }
}
function finalize(){
  const pool=JSON.parse(fs.readFileSync(path.join(folder,'candidates.json'),'utf8'));
  const solution=JSON.parse(fs.readFileSync(path.join(folder,'solution.json'),'utf8'));
  const byId=new Map(pool.candidates.map(c=>[c.id,c]));
  const expand=c=>{if(!c||!c.unitIndexes)return c;const ids=c.unitIndexes.map(i=>pool.units[i].id);let at=0;
    return {...c,unitIds:ids,pieces:c.pieces.map(({unitCount,...p})=>({...p,tripIds:ids.slice(at,at+=unitCount)}))};};
  const selected=solution.selectedCandidateIds.map(id=>expand(byId.get(id)));
  if(selected.some(c=>!c))throw new Error('Unknown selected candidate.');
  const counters={};
  const dailyRuns=selected.sort((a,b)=>a.dayType.localeCompare(b.dayType)||a.reportTime-b.reportTime).map(c=>{
    counters[c.dayType]=(counters[c.dayType]||0)+1;
    return {id:c.id,runNumber:`${{Weekday:'W',Saturday:'S',Sunday:'U'}[c.dayType]}-${String(counters[c.dayType]).padStart(3,'0')}`,dayType:c.dayType,pieces:c.pieces.map((p,i)=>({...p,id:`${c.id}-piece-${i+1}`}))};
  });
  const draft={schemaVersion:1,kind:'operations-planning-proposal',scenarioId:unitInput.scenarioId,sourceManifestFingerprint:unitInput.sourceManifest.fingerprint,
    codex:{generatedAt:new Date().toISOString(),rationale:'Source-backed interior relief, exact-cover daily work and constrained repeating weekly rosters.'},
    blockAudits:unitInput.blockAudits,dailyRuns,weeklyRosters:solution.weeklyRosters||[],findings:[],methodNotes:[
      inputFile?'Current Master versions pinned by the app export. Fixed-route work only; separately sourced TOD, RPT and standby excluded.':'Original Master source versions retained, not certified as the September board. Fixed-route work only; separately sourced TOD, RPT and standby excluded.',
      'Vehicle trips and block order unchanged. Operator coverage uses pinned interior relief events.',
      '7.5-hour no-meal driving cap; 90-minute whole-gap split threshold. Meals exclude movement and preparation.',
      extended?'Candidate search is bounded, not a proof of optimality. Standard meals only; cross-route transfers only where the app validator allows them; three-piece duties only for otherwise uncovered work.':'Candidate search is bounded, not a proof of optimality. Standard meals and same-route transfers only.',
      'Relief-cab capacity uses the existing conservative per-operator approximation; no cab dispatch or pooling allocation is claimed.',
      ...(pool.withheldBlocks?.length?[`INCOMPLETE: ${pool.withheldBlocks.length} source-invalid vehicle blocks withheld in full. Their service is not assigned; this is a diagnostic draft, not an operational cut.`]:[]),
    ]};
  const proposal=restoreOperationsPlanningProposal(input,draft);
  const assessment=assessOperationsPlanningProposal(input,proposal);
  write('operations-planning-proposal-v2.json',proposal);
  write('assessment.json',assessment);
  console.log(JSON.stringify({dailyRuns:dailyRuns.length,byDay:counters,crews:proposal.weeklyRosters.length,approvalReady:assessment.approvalReady,
    blockers:assessment.findings.filter(f=>['integrity','contractual'].includes(f.category)).map(f=>({code:f.code,message:f.message}))}));
}
if(process.argv.includes('--finalize'))finalize();else prepare();
