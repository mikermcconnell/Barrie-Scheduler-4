async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let checks=0;const ok=(v,m)=>{if(!v)throw new Error(m);checks++;};
 await page.goto('http://127.0.0.1:8766/04-go-grid.html');
 await page.getByRole('heading',{name:'GO Train & Barrie Transit connections',exact:true}).waitFor();
 for(const station of ['Allandale Waterfront','Barrie South'])for(const dir of ['Both directions','To GO','From GO']){
  await page.getByRole('button',{name:station,exact:true}).click();
  await page.getByRole('button',{name:dir,exact:true}).click();
  const tables=await page.locator('table').count();ok(tables===(dir==='Both directions'?2:1),'Direction visibility');
  const trainCols=await page.locator('thead th').count();ok(trainCols===tables*9,'Eight train columns per grid');
  const cells=await page.locator('[data-cell]').count();ok(cells===tables*8*(station==='Barrie South'?3:8),'Route cells');
 }
 await page.getByRole('button',{name:'Allandale Waterfront',exact:true}).click();
 await page.getByRole('button',{name:'Both directions',exact:true}).click();
 for(const [selector,text] of [['to:0:2','6:06 AM'],['from:0:3','6:38 PM'],['from:1:3','6:54 PM'],['from:5:3','6:54 PM'],['from:3:7','12:17 AM +1']]){
  ok((await page.locator('[data-cell="'+selector+'"]').innerText()).includes(text),'PDF transcription '+selector);
 }
 await page.locator('[data-cell="from:3:7"]').click();
 ok((await page.getByRole('dialog').innerText()).includes('10-minute scheduled gap'),'Midnight gap preserved');
 await page.keyboard.press('Escape');ok(!(await page.getByRole('dialog').isVisible()),'Keyboard closes detail');
 await page.locator('[data-cell="from:6:0"]').click();
 ok((await page.getByRole('dialog').innerText()).includes('725-minute scheduled gap'),'Source anomaly retained');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('[data-cell="to:0:0"]').click();
 ok((await page.getByRole('dialog').innerText()).includes('No bus time is printed'),'Blank does not imply no current service');
 await page.keyboard.press('Escape');
 ok((await page.locator('.summary-row').last().innerText()).includes('5 / 8 directions'),'Corrected 6825 summary');
 await page.setViewportSize({width:1363,height:900});
 await page.screenshot({path:'output/playwright/regional-transit-connections/04-go-grid-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page-level overflow');
 await page.locator('.scroll').first().evaluate(el=>{el.scrollLeft=el.scrollWidth;});
 ok(await page.locator('.scroll').first().evaluate(el=>el.scrollLeft>0),'Train grid scrolls horizontally');
 await page.screenshot({path:'output/playwright/regional-transit-connections/04-go-grid-mobile.png',fullPage:true});
 await page.setViewportSize({width:1363,height:900});
 await page.locator('.scroll').first().evaluate(el=>{el.scrollLeft=0;});
 await page.emulateMedia({media:'print'});
 await page.pdf({path:'output/playwright/regional-transit-connections/04-go-grid-print.pdf',format:'A3',landscape:true,printBackground:true});
 await page.emulateMedia({media:'screen'});
 ok(errors.length===0,'No browser script errors');
 return {checks,stationDirectionCombinations:6,errors};
}

