async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let checks=0;const ok=(v,m)=>{if(!v)throw new Error(m);checks++;};
 await page.route('https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip',route=>route.fulfill({path:'C:/Users/Mike McConnell/Documents/mike_apps/Scheduler 4/output/playwright/regional-transit-connections/reference/go-current.zip',contentType:'application/zip'}));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:8767');
 await page.getByLabel('Service date').fill('2026-10-05');
 await page.getByRole('table').first().waitFor({timeout:60000});
 ok(await page.getByRole('heading',{name:'GO train connections',exact:true}).count()===1,'Train heading');
 ok(await page.getByRole('img',{name:'GO Transit'}).evaluate(el=>el.complete&&el.naturalWidth>0),'Official logo loads');
 ok(await page.locator('.regional-go-train-count svg').count()===2,'Sticky train icons');
 ok(await page.locator('tbody th').count()===6,'Only three connecting fixture routes remain in both grids');
 ok(await page.locator('tbody th').filter({hasText:/Route (7|9)\b/}).count()===0,'Failed and wholly disconnected routes hidden');
 ok(await page.locator('.regional-go-warning').textContent().then(v=>v.includes('Route 7 not assessed')),'Source warning retained');
 ok(await page.locator('tfoot td').first().textContent().then(v=>v.includes('/ 4 checked')),'Hidden assessed route remains in denominator');
 const longCell=page.locator('td.regional-go-long').first();
 ok(await longCell.count()===1,'Long connection available');
 ok(await longCell.evaluate(el=>getComputedStyle(el).backgroundColor==='rgb(241, 243, 245)'),'Long cells muted grey');
 ok(await page.locator('.regional-go-legend i.regional-go-long').evaluate(el=>getComputedStyle(el).backgroundColor==='rgb(241, 243, 245)'),'Legend muted grey');
 await longCell.locator('button').click();
 ok(await page.locator('.regional-go-detail-status').evaluate(el=>getComputedStyle(el).backgroundColor==='rgb(241, 243, 245)'),'Details muted grey');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Full screen',exact:true}).click();
 ok(await page.locator('.regional-go-scroll').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Desktop fullscreen fits all columns');
 await page.screenshot({path:'output/playwright/regional-transit-connections/react-muted-long-fullscreen.png'});
 await page.keyboard.press('Escape');
 for(const day of ['Saturday','Sunday','Weekday']) {
  await page.getByRole('button',{name:day,exact:true}).click();
  await page.getByRole('table').first().waitFor();
  ok(await page.locator('tbody th').filter({hasText:/Route (7|9)\b/}).count()===0,day+' keeps routes filtered');
 }
 await page.setViewportSize({width:390,height:844});
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile page overflow');
 await page.screenshot({path:'output/playwright/regional-transit-connections/react-muted-long-mobile.png',fullPage:true});
 ok(errors.length===0,'No runtime errors');
 return {checks,errors,masterSource:'Fixture only',goSource:'Previously downloaded public GO ZIP through production parser; network intercepted for this layout check'};
}