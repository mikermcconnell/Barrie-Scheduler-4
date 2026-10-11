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
const folder = path.resolve(__dirname, '../outputs/corrected-run-cut-20260921');
const write = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2));
const snapshot = JSON.parse(fs.readFileSync(path.join(folder, 'master-source-snapshot.json'), 'utf8'));
const input = buildOperationsPlanningInput({ schemaVersion: 2, scenarioId: 'corrected-full-master-2026-09-21', scenarioName: 'Corrected fixed-route run cut, original Master sources', exportedAt: snapshot.retrievedAt, pinnedSchedules: snapshot.schedules });
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
function prepare() {
  const integrity=unitInput.blockAudits.flatMap(b=>b.findings).filter(f=>f.category==='integrity');
  const withheldBlocks=unitInput.blockAudits.filter(b=>b.findings.some(f=>f.category==='integrity'));
  const withheldKeys=new Set(withheldBlocks.map(b=>b.vehicleBlockKey));
  write('source-findings.json',integrity);
  write('withheld-blocks.json',withheldBlocks);
  if(integrity.length)console.log(`${integrity.length} unresolved source findings: withholding ${withheldBlocks.length} whole blocks. Output is incomplete and cannot be approved.`);
  write('operations-planning-input-v2.json',input);
  write('projected-input.json',unitInput);
  const pieces=[],candidates=[],seen=new Set();
  function add(ps,m) {
    if(m.paidMinutes<420||m.paidMinutes>600||m.spreadMinutes>660||m.platformMinutes>rules.maximumDrivingMinutes)return;
    if(m.longestContinuousPlatformMinutes>(m.isSplit?rules.splitPieceDrivingMaximumMinutes:rules.straightDrivingMaximumMinutes))return;
    const key=ps.map(p=>p.tripIds.join('|')).join(' / ');if(seen.has(key))return;seen.add(key);
    const id=`candidate-${String(candidates.length+1).padStart(6,'0')}`;
    const dayType=map.get(ps[0].tripIds[0]).dayType;
    candidates.push({id,dayType,unitIds:ps.flatMap(p=>p.tripIds),pieces:ps,paidMinutes:m.paidMinutes,platformMinutes:m.platformMinutes,
      reportTime:m.reportTime,offTime:m.offTime,spreadMinutes:m.spreadMinutes,isSplit:m.isSplit,cabIntervals:cabsFor(ps),
      cost:10000+Math.abs(m.paidMinutes-490)*15+(m.isSplit?1500:0)+(ps.length>1?50:0)});
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
        if(driving>=110&&driving<=300&&m.spreadMinutes<=380)pieces.push({piece,dayType:block.dayType,start:ts[a].startTime,end:ts[b].arrivalTime,driving});
      }
    }
    console.log(`Enumerated ${block.blockId} ${block.dayType}: ${candidates.length} singles, ${pieces.length} meal pieces`);
  }
  const groups=new Map();for(const p of pieces){const key=p.dayType+':'+p.piece.routeNumber;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  for(const [key,group] of groups){
    group.sort((a,b)=>a.start-b.start);
    let tested=0;
    for(const left of group){
      const options=[];
      for(const right of group){
        if(right.start<left.end+30)continue;if(right.start>left.end+240)break;
        if(left.driving+right.driving<340||left.driving+right.driving>570)continue;
        if(right.end-left.start>630)continue;
        const transition=calculatePieceTransition(unitInput,left.piece,right.piece,map);
        if(!transition||!transition.travelResolved||!transition.timingResolved||!transition.travelFits||!transition.breakLocationAllowed)continue;
        // Use standard meals only; unresolved short-break exceptions are not needed.
        if(transition.qualifyingBreakMinutes<rules.standardBreakMinutes.minimum)continue;
        if(!transition.isSplit&&transition.qualifyingBreakMinutes>rules.standardBreakMinutes.maximum)continue;
        if(left.piece.tripIds.some(id=>right.piece.tripIds.includes(id)))continue;
        const approximatePaid=(left.end-left.start)+(right.end-right.start)+35;
        options.push({right,score:Math.abs(approximatePaid-490)+(transition.isSplit?35:0)});
      }
      // Bounded candidate search, not an exhaustive proof of real-world feasibility.
      options.sort((a,b)=>a.score-b.score);
      for(const {right} of options.slice(0,8)){
        const ps=[left.piece,right.piece],m=metricsFor(ps);tested++;
        if(m.longestContinuousPlatformMinutes>300)continue;
        add(ps,m);
      }
    }
    console.log(`Paired ${key}: tested ${tested}; total candidates ${candidates.length}`);
  }
  const units=unitInput.trips.filter(t=>!withheldKeys.has(t.vehicleBlockKey)).map(t=>({id:t.id,dayType:t.dayType}));
  const covered=new Set(candidates.flatMap(c=>c.unitIds));
  const uncovered=units.filter(u=>!covered.has(u.id));
  write('candidates.json',{units,candidates,rules,uncovered,withheldBlocks:withheldBlocks.map(b=>b.vehicleBlockKey),method:'Bounded single/two-piece same-route candidates; standard meals only; no rule relaxations. Source-invalid blocks withheld, never assigned.'});
  console.log(JSON.stringify({units:units.length,candidates:candidates.length,uncovered:uncovered.length}));
}
function finalize(){
  const pool=JSON.parse(fs.readFileSync(path.join(folder,'candidates.json'),'utf8'));
  const solution=JSON.parse(fs.readFileSync(path.join(folder,'solution.json'),'utf8'));
  const selected=solution.selectedCandidateIds.map(id=>pool.candidates.find(c=>c.id===id));
  if(selected.some(c=>!c))throw new Error('Unknown selected candidate.');
  const counters={};
  const dailyRuns=selected.sort((a,b)=>a.dayType.localeCompare(b.dayType)||a.reportTime-b.reportTime).map(c=>{
    counters[c.dayType]=(counters[c.dayType]||0)+1;
    return {id:c.id,runNumber:`${{Weekday:'W',Saturday:'S',Sunday:'U'}[c.dayType]}-${String(counters[c.dayType]).padStart(3,'0')}`,dayType:c.dayType,pieces:c.pieces.map((p,i)=>({...p,id:`${c.id}-piece-${i+1}`}))};
  });
  const draft={schemaVersion:1,kind:'operations-planning-proposal',scenarioId:unitInput.scenarioId,sourceManifestFingerprint:unitInput.sourceManifest.fingerprint,
    codex:{generatedAt:new Date().toISOString(),rationale:'Source-backed interior relief, exact-cover daily work and constrained repeating weekly rosters.'},
    blockAudits:unitInput.blockAudits,dailyRuns,weeklyRosters:solution.weeklyRosters||[],findings:[],methodNotes:[
      'Original Master source versions retained, not certified as the September board. Fixed-route work only; separately sourced TOD, RPT and standby excluded.',
      'Vehicle trips and block order unchanged. Operator coverage uses pinned interior relief events.',
      '7.5-hour no-meal driving cap; 90-minute whole-gap split threshold. Meals exclude movement and preparation.',
      'Candidate search is bounded, not a proof of optimality. Standard meals and same-route transfers only.',
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
