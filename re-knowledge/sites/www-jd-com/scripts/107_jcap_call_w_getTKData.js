#!/usr/bin/env node
/**
 * 107_jcap_call_w_getTKData.js
 *
 * 触发 jcap 后，从 w 实例上实际调用 getTKData/CTData/CSData/parse
 * 拿到真实输出
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*jcap_ujb96b.js*', requestStage: 'Response' }],
  });

  await cdp.on('Fetch.requestPaused', async (event) => {
    try {
      const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
      let body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf-8') : resp.body;

      // 暴露 w 实例 + 在 tk: k(...) 处 dump 调用
      const wCreateVariant = 'w=new(a["Cap"+e(533,561)+"aWe"+e(550,536)+e(548,521)+"bly"])(i)';
      if (body.includes(wCreateVariant)) {
        body = body.replace(wCreateVariant, wCreateVariant + ';window.__w=w;window.__kFn=k;window.__xFn=x;window.__FFn=F;window.__NFn=N;window.__Rfn=R;window.__Gfn=G;window.__S=S;');
      }

      // 在 tk: k(...) 处注入 hook，记录真实调用
      const tkVariants = [
        'tk: k([a, s, A, JSON.stringify(f)])',
        'tk:k([a,s,A,JSON.stringify(f)])',
        'tk: k([a,s,A,JSON.stringify(f)])',
        'tk:k([a, s, A, JSON.stringify(f)])',
      ];
      let tkPatched = false;
      for (const v of tkVariants) {
        if (body.includes(v)) {
          const repl = "tk: ((tkInput) => { try { window.__tkInput = tkInput; console.log('TK_INPUT ' + JSON.stringify({input: tkInput, length: tkInput.length, sample: tkInput[2].substring(0,200)})); var tkOut = k(tkInput); window.__tkOuts = window.__tkOuts || []; window.__tkOuts.push({input: tkInput, output: tkOut}); console.log('TK_OUTPUT ' + JSON.stringify({type: typeof tkOut, length: tkOut ? tkOut.length : 0, sample: tkOut ? tkOut.substring(0,200) : null})); return tkOut; } catch(e) { console.log('TK_ERR ' + e.message); throw e; } })([a, s, A, JSON.stringify(f)])";
          body = body.replace(v, repl);
          tkPatched = true;
          console.log('[PATCH] tk variant matched:', v);
          break;
        }
      }

      // 在 cs: F([a, JSON.stringify(p)]) 处注入
      const csVariants = [
        'cs: F([a, JSON.stringify(p)])',
        'cs:F([a,JSON.stringify(p)])',
        'cs: F([a,JSON.stringify(p)])',
        'cs:F([a, JSON.stringify(p)])',
      ];
      for (const v of csVariants) {
        if (body.includes(v)) {
          const repl = "cs: ((csInput) => { try { window.__csInput = csInput; console.log('CS_INPUT ' + JSON.stringify({input: csInput})); var csOut = F(csInput); window.__csOut = csOut; console.log('CS_OUTPUT ' + JSON.stringify({type: typeof csOut, length: csOut ? csOut.length : 0, sample: csOut ? csOut.substring(0,200) : null})); return csOut; } catch(e) { console.log('CS_ERR ' + e.message); throw e; } })([a, JSON.stringify(p)])";
          body = body.replace(v, repl);
          console.log('[PATCH] cs variant matched');
          break;
        }
      }

      // 在 ct: x([a, C]) 处注入
      const ctVariants = [
        'ct: x([a, C])',
        'ct:x([a,C])',
        'ct: x([a,C])',
        'ct:x([a, C])',
      ];
      for (const v of ctVariants) {
        if (body.includes(v)) {
          const repl = "ct: ((ctInput) => { try { window.__ctInput = ctInput; console.log('CT_INPUT ' + JSON.stringify({input: ctInput})); var ctOut = x(ctInput); window.__ctOut = ctOut; console.log('CT_OUTPUT ' + JSON.stringify({type: typeof ctOut, length: ctOut ? ctOut.length : 0, sample: ctOut ? ctOut.substring(0,200) : null})); return ctOut; } catch(e) { console.log('CT_ERR ' + e.message); throw e; } })([a, C])";
          body = body.replace(v, repl);
          console.log('[PATCH] ct variant matched');
          break;
        }
      }

      const newBody = Buffer.from(body, 'utf-8').toString('base64');
      await cdp.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: event.responseHeaders,
        body: newBody,
      });
    } catch (e) {
      console.log('Fetch error:', e.message);
      try { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); } catch (_) {}
    }
  });

  page.on('console', m => {
    const t = m.text();
    if (/^TK_|^CT_|^CS_/.test(t)) {
      console.log('[BROWSER]', t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  const ts = Date.now().toString().slice(-8);
  async function humanInput(sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await sleep(100);
    await page.mouse.click(x, y, { clickCount: 3 });
    await sleep(100);
    for (const ch of text) await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
  }
  async function humanClick(sel) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 10 + Math.random() * (box.width - 20);
    const y = box.y + 5 + Math.random() * (box.height - 10);
    await page.mouse.move(x, y, { steps: 5 });
    await sleep(150);
    await page.mouse.click(x, y);
  }

  await humanInput('#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(500);
  await humanInput('#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  let triggered = false;
  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2000);
      try {
        const r = await page.$('#cpc_img, #curve_main_img, #main_img');
        if (r) { console.log('触发 click=' + i); triggered = true; break; }
      } catch (e) {}
    }
    if (triggered) break;
    await sleep(3000);
  }
  if (!triggered) { console.log('未触发 jcap'); await browser.close(); return; }
  await sleep(5000);

  // 检查是否拿到 cpc_img
  let imgInfo;
  try {
    imgInfo = await page.evaluate(() => {
      const cpc = document.querySelector('#cpc_img');
      if (!cpc) return null;
      const r = cpc.getBoundingClientRect();
      return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
    });
  } catch(e) { console.log('imgInfo error:', e.message); }
  if (!imgInfo) { console.log('no cpc_img'); await browser.close(); return; }

  // 画对角线
  const x1 = imgInfo.x + 20;
  const y1 = imgInfo.y + 20;
  const x2 = imgInfo.x + imgInfo.dw - 20;
  const y2 = imgInfo.y + imgInfo.dh - 20;
  await page.mouse.move(x1, y1, { steps: 10 });
  await sleep(200);
  await page.mouse.down();
  await sleep(100);
  for (let i = 1; i <= 30; i++) {
    const t = i / 30;
    await page.mouse.move(x1 + t * (x2 - x1), y1 + t * (y2 - y1));
    await sleep(30);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(10000);

  // 抓所有数据
  const result = await page.evaluate(() => {
    return {
      wType: typeof window.__w,
      wCtor: window.__w ? window.__w.constructor.name : null,
      wMethods: window.__w ? Object.getOwnPropertyNames(Object.getPrototypeOf(window.__w)).filter(n => typeof window.__w[n] === 'function') : null,
      tkInput: window.__tkInput,
      tkOuts: window.__tkOuts,
      ctInput: window.__ctInput,
      ctOut: window.__ctOut,
      csInput: window.__csInput,
      csOut: window.__csOut,
      // 试直接调 w 方法
      wGetTKData: window.__w ? typeof window.__w.getTKData : null,
      wGetCTData: window.__w ? typeof window.__w.getCTData : null,
    };
  });
  console.log('\n=== 抓取结果 ===');
  console.log(JSON.stringify(result, null, 2).substring(0, 5000));

  await browser.close();
})();
