import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const folder=path.dirname(fileURLToPath(import.meta.url));
const read=async name=>JSON.parse(await fs.readFile(path.join(folder,name),'utf8'));
const [source,input,findings,withheld]=await Promise.all(['master-source-snapshot.json','operations-planning-input-v2.json','source-findings.json','withheld-blocks.json'].map(read));
const tripMap=new Map(input.trips.map(t=>[t.id,t]));
const sourceMap=new Map(source.schedules.map(s=>[s.entry.id,s]));
const workbook=Workbook.create();
const sheets={};
function sheet(name,title,subtitle,headers,rows,widths){
  const s=workbook.worksheets.add(name);sheets[name]=s;s.showGridLines=false;
  s.getRangeByIndexes(0,0,Math.max(rows.length+4,12),headers.length).format.font={name:'Arial',size:11,color:'#1F2937'};
  s.getRange('A1').values=[[title]];s.getRange('A1').format.font={name:'Arial',size:15,bold:true};
  s.getRange('A2').values=[[subtitle]];s.getRange('A2').format.font={italic:true,color:'#475569'};
  s.getRangeByIndexes(3,0,1,headers.length).values=[headers];
  s.getRangeByIndexes(3,0,1,headers.length).format={fill:'#004E80',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:32};
  if(rows.length)s.getRangeByIndexes(4,0,rows.length,headers.length).values=rows;
  s.getRangeByIndexes(4,0,Math.max(1,rows.length),headers.length).format.rowHeight=24;
  widths.forEach((width,i)=>s.getRangeByIndexes(0,i,Math.max(rows.length+4,12),1).format.columnWidth=width);
  if(rows.length>20)s.freezePanes.freezeRows(4);
  if(rows.length)s.tables.add(s.getRangeByIndexes(3,0,rows.length+1,headers.length),true,name.replaceAll(' ','')+'Table');
  return s;
}
const problemTrips=new Set(findings.map(f=>f.tripId));
const heldSourceTrips=input.trips.filter(t=>withheld.some(b=>b.vehicleBlockKey===t.vehicleBlockKey)).length;
const summary=sheet('Summary','Run-cut source timing review','Original Master versions, retrieved September 21, 2026',['Item','Result'],[
  ['Full operational cut','Not generated: Master timing conflicts require resolution'],
  ['Schedules checked',source.schedules.length],
  ['Source trips',input.trips.length],
  ['Trips with conflicting timing',problemTrips.size],
  ['Vehicle blocks withheld',withheld.length],
  ['All source trips in withheld blocks',heldSourceTrips],
  ['Other trips with conserved driving',input.trips.length-problemTrips.size],
  ['Original source fingerprint',source.sourceManifest.fingerprint],
  ['Scope','Fixed-route Master sources behind the original draft; not verified as September board service'],
  ['Published schedules','Unchanged'],
  ['Run-cut model','Interior operator relief supported locally; no vehicle trips re-timed or re-blocked'],
  ['Required decision','Resolve four Saturday backward-time trips and nine weekday driving-total discrepancies'],
  ['Generation status','Candidate search remains incomplete; no complete daily selection or weekly roster produced'],
  ['Source authority','Authenticated Master metadata and full schedule payloads, same versions and fingerprint as first draft'],
],[36,105]);
summary.getRange('B5:B18').format.wrapText=true;
summary.getRange('A13:B18').format.rowHeight=38;
const conflicts=findings.map(f=>{
  const t=tripMap.get(f.tripId);const match=f.message.match(/stop-derived driving (\d+) does not equal source driving (\d+)/);
  return [t.routeIdentity,t.blockId,t.sourceTripId,match?'Driving total differs':'Non-chronological stop times',t.travelTime,match?Number(match[1]):null,null,
    match?'Confirm the driving total against the published stop times':'Confirm the correct interline stop sequence and times'];
});
const conflictSheet=sheet('Source conflicts','Trips requiring source correction','Minutes are driving time, not paid time or spread',['Route / day','Source block','Trip','Conflict','Stored minutes','Derived minutes','Difference','Required review'],conflicts,[22,15,17,32,16,16,14,64]);
conflictSheet.getRange(`G5:G${4+conflicts.length}`).formulas=conflicts.map((_,i)=>[`=IF(F${i+5}="","",F${i+5}-E${i+5})`]);
conflictSheet.getRange(`E5:G${4+conflicts.length}`).setNumberFormat('0');
conflictSheet.getRange(`D5:D${4+conflicts.length}`).format.wrapText=true;
conflictSheet.getRange(`H5:H${4+conflicts.length}`).format.wrapText=true;
conflictSheet.getRange(`A5:H${4+conflicts.length}`).format.rowHeight=36;
conflictSheet.getRange(`G5:G${4+conflicts.length}`).conditionalFormats.add('cellIs',{operator:'notEqual',formula:0,format:{fill:'#FDE9D9',font:{color:'#9C2B14'}}});
const rawRows=[];
for(const f of findings){const t=tripMap.get(f.tripId),s=sourceMap.get(t.routeIdentity);const raw=[...s.content.northTable.trips,...s.content.southTable.trips].find(r=>r.id===t.sourceTripId&&r.direction===t.direction);
  for(const [stop,time]of Object.entries(raw.stops))rawRows.push([t.routeIdentity,t.blockId,t.sourceTripId,stop,time,raw.arrivalTimes?.[stop]||null,raw.recoveryTimes?.[stop]??null]);
}
sheet('Recorded stop times','Master stop-time evidence','Raw clock text is preserved where source chronology is disputed',['Route / day','Source block','Trip','Source stop column','Recorded clock text','Explicit arrival text','Recovery minutes'],rawRows,[22,15,17,58,23,23,20]);
const blocks=withheld.map(b=>{const src=input.blockAudits.find(a=>a.vehicleBlockKey===b.vehicleBlockKey);return [b.dayType,src.sourceBlockIds.join(', '),src.routeIdentities.join(', '),src.tripIds.length,b.findings.filter(f=>f.category==='integrity').length];});
sheet('Withheld blocks','Vehicle blocks withheld from cutting','Entire affected blocks remain unassigned pending source correction',['Day type','Source block IDs','Source route / days','Source trips','Timing findings'],blocks,[20,23,46,18,20]);
sheet('Sources','Pinned Master versions','These are the versions behind the first draft, not a September-board certification',['Route / day','Version','Trips','Source uploaded','SHA-256'],source.schedules.map(s=>[s.entry.id,s.entry.currentVersion,s.entry.tripCount,s.content.metadata.uploadedAt,s.sha256]),[24,12,12,30,72]);
sheets.Sources.getRange(`D5:D${4+source.schedules.length}`).setNumberFormat('yyyy-mm-dd hh:mm');
console.log((await workbook.inspect({kind:'table',range:'Source conflicts!A4:H9',include:'values,formulas',tableMaxRows:6,tableMaxCols:8,maxChars:3000})).ndjson);
console.log((await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},summary:'formula error scan'})).ndjson);
for(const name of Object.keys(sheets)){
  const ranges={'Summary':'A1:B18','Source conflicts':'A1:H10','Recorded stop times':'A1:G12','Withheld blocks':'A1:E11','Sources':'A1:E12'};
  const image=await workbook.render({sheetName:name,range:ranges[name],scale:1,format:'png'});
  await fs.writeFile(path.join(folder,`preview-${name.replaceAll(' ','-')}.png`),new Uint8Array(await image.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(workbook)).save(path.join(folder,'Master-timing-conflicts.xlsx'));
console.log(JSON.stringify({file:'Master-timing-conflicts.xlsx',sourceTrips:input.trips.length,conflictingTrips:problemTrips.size,withheldBlocks:withheld.length,heldSourceTrips}));
