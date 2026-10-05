async (page) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const expected={all:{all:[7,2,2,1],to:[3,2,1,0],from:[4,0,1,1]},allandale:{all:[3,1,0,0],to:[1,1,0,0],from:[2,0,0,0]},south:{all:[2,0,2,0],to:[1,0,1,0],from:[1,0,1,0]},downtown:{all:[2,1,0,1],to:[1,1,0,0],from:[1,0,0,1]}};
  const names={all:'Both directions',to:'To regional',from:'From regional'};
  const files=['01-executive','02-locations','03-journeys'];
  let checks=0;
  const assert=(ok,why)=>{if(!ok)throw new Error(why);checks++;};
  for(let v=0;v<files.length;v++) {
    await page.setViewportSize({width:1363,height:900});
    await page.goto('http://127.0.0.1:8766/'+files[v]+'.html');
    await page.getByRole('heading',{name:'Regional transit connections',exact:true}).waitFor();
    for(const loc of Object.keys(expected))for(const dir of Object.keys(names)) {
      await page.getByRole('combobox',{name:'Location',exact:true}).selectOption(loc);
      await page.getByRole('button',{name:names[dir],exact:true}).click();
      const wanted=expected[loc][dir];
      const values=await page.locator(v===0?'.metric .number':v===1?'.coverage-numbers b':'.journey-option .badge').allTextContents();
      const actual=v<2?values.map(x=>parseInt(x,10)):['Comfortable','Tight','Needs review','Not assessed'].map(s=>values.filter(x=>x===s).length);
      assert(JSON.stringify(actual)===JSON.stringify(wanted),files[v]+' filter '+loc+'/'+dir+' counts '+JSON.stringify(actual));
    }
    await page.getByRole('combobox',{name:'Location',exact:true}).selectOption('all');
    await page.getByRole('button',{name:'Both directions',exact:true}).click();
    if(v===0) {
      await page.getByRole('button',{name:'View connection →',exact:true}).first().click();
      assert(await page.getByRole('dialog').isVisible(),'Summary detail opens');
      assert((await page.getByRole('dialog').innerText()).includes('Cannot make this transfer'),'Impossible transfer detail');
      await page.keyboard.press('Escape');
      assert(!(await page.getByRole('dialog').isVisible()),'Escape closes dialog');
    } else if(v===1) {
      await page.locator('.hub summary').first().click();
      assert(await page.locator('.hub-trip').first().isVisible(),'Hub expands');
      await page.locator('.hub-trip [data-detail]').first().click();
      assert((await page.getByRole('dialog').innerText()).includes('14 minutes remaining'),'Hub detail math');
      await page.getByRole('button',{name:'Close',exact:true}).click();
      await page.locator('.hub summary').first().click();
    } else {
      for(const [id,text] of [[5,'Cannot make this transfer'],[7,'32-minute wait'],[12,'Not enough information']]) {
        await page.locator('[data-journey="'+id+'"]').click();
        assert((await page.locator('#journey-detail').innerText()).includes(text),'Journey '+id+' outcome');
      }
      await page.locator('[data-journey="1"]').click();
    }
    await page.setViewportSize({width:390,height:844});
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert(geometry.scroll<=geometry.width,'No page overflow '+files[v]);
    await page.screenshot({path:'output/playwright/regional-transit-connections/'+files[v]+'-mobile.png',fullPage:true});
  }
  await page.goto('http://127.0.0.1:8766/index.html');
  assert(await page.locator('.choice').count()===3,'Three choices');
  await page.getByRole('link').filter({hasText:'Executive summary'}).click();
  await page.getByRole('heading',{name:'Regional transit connections',exact:true}).waitFor();
  await page.setViewportSize({width:1363,height:900});
  await page.emulateMedia({media:'print'});
  await page.pdf({path:'output/playwright/regional-transit-connections/summary-print.pdf',format:'A4',printBackground:true,margin:{top:'10mm',bottom:'10mm',left:'10mm',right:'10mm'}});
  await page.emulateMedia({media:'screen'});
  assert(errors.length===0,'No browser errors: '+errors.join('; '));
  console.log(JSON.stringify({passed:checks,filterCombinations:36,viewports:[1363,390],browserErrors:errors,printPdf:'summary-print.pdf'}));
}
