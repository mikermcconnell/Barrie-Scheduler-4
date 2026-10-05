import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const notes=[];
try {
 await page.goto('http://127.0.0.1:5198/output/playwright/aggregation-harness.html',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByText('Total Ridership',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Weekday',exact:true}).click();
 const metric=label=>page.getByText(label,{exact:true}).locator('..').locator('p.text-2xl');
 assert.equal(await metric('Total Ridership').innerText(),'500');notes.push('PASS Past Week + Weekday + Sum: 500 boardings across five weekdays');
 await page.screenshot({path:'output/playwright/aggregation-sum-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Daily average',exact:true}).click();
 assert.equal(await metric('Ridership / weekday').innerText(),'100');
 assert.equal(await metric('On-Time Performance').innerText(),'85%');
 assert.equal(await metric('Trips Operated / weekday').innerText(),'10 / 10');
 assert.ok((await page.locator('body').innerText()).includes('Based on 5 weekdays with data'));
 notes.push('PASS Daily average: 100 boardings/weekday, 10/10 trips/weekday; OTP unchanged at 85%; five-day coverage visible');
 await page.screenshot({path:'output/playwright/aggregation-average-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'OTP Analysis',exact:true}).click();
 await page.getByText('OTP percentages remain weighted by eligible observations.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Daily average',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Overview',exact:true}).click();
 await page.getByText('Ridership / weekday',{exact:true}).waitFor();
 assert.equal(await metric('Ridership / weekday').innerText(),'100');notes.push('PASS Daily average + Weekday persist Overview → OTP Analysis → Overview');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);
 const mobile=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 notes.push(`${mobile.document<=mobile.viewport?'PASS':'FAIL'} mobile overflow: ${JSON.stringify(mobile)}`);
 await page.screenshot({path:'output/playwright/aggregation-average-mobile.png',fullPage:true});
 assert.equal(await page.getByRole('button',{name:'Daily average',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Sum',exact:true}).click();assert.equal(await metric('Total Ridership').innerText(),'500');notes.push('PASS Mobile Sum toggle returns 500 boardings');
 notes.push(`Page errors: ${JSON.stringify(errors)}`);
} catch(e) {notes.push('FAIL '+e.stack);await page.screenshot({path:'output/playwright/aggregation-failure.png',fullPage:true});process.exitCode=1;}
finally {await fs.writeFile('output/playwright/aggregation-results.json',JSON.stringify(notes,null,2));console.log(notes.join('\n'));await browser.close();}
