#!/usr/bin/env node
/**
 * 110_jcap_inspect_touchlist.js
 *
 * 抓 jcap 收到的 touchList，看它解码的 xyList、touchList 是什么
 * 验证我们的拖动是否被 jcap 正确接收
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

      // 暴露 w
      const wCreateVariant = 'w=new(a["Cap"+e(533,561)+"aWe"+e(550,536)+e(548,521)+"bly"])(i)';
      if (body.includes(wCreateVariant)) {
        body = body.replace(wCreateVariant, wCreateVariant + ';window.__w=w;');
      }

      // 在 tk: k([a, s, A, JSON.stringify(f)]) 注入 dump
      const tkVariants = [
        'tk:k([a,s,A,JSON.stringify(f)])',
        'tk: k([a, s, A, JSON.stringify(f)])',
        'tk: k([a,s,A,JSON.stringify(f)])',
      ];
      for (const v of tkVariants) {
        if (body.includes(v)) {
          const repl = "tk: ((tkInput) => { try { window.__tkLastInput = tkInput; window.__tkA = tkInput[2]; window.__tkTouch = tkInput[3]; console.log('TK_IN a=' + tkInput[0].substring(0,40) + ' s=' + tkInput[1] + ' A.len=' + (tkInput[2] ? tkInput[2].length : 0) + ' touch=' + tkInput[3].substring(0,300)); var tkOut = k(tkInput); window.__tkLastOut = tkOut; console.log('TK_OUT len=' + tkOut.length); return tkOut; } catch(e) { console.log('TK_ERR ' + e.message); throw e; } })([a, s, A, JSON.stringify(f)])";
          body = body.replace(v, repl);
          console.log('[PATCH] tk matched');
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
      try { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); } catch (_) {}
    }
  });

  page.on('console', m => {
    const t = m.text();
    if (/^TK_/.test(t)) console.log('[BROWSER]', t);
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/check') || url.includes('/api/verify')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

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
  if (!triggered) { console.log('未触发'); await browser.close(); return; }
  await sleep(3000);

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
  console.log('imgInfo:', JSON.stringify(imgInfo));

  // 慢速水平拖动 200 像素
  const x1 = imgInfo.x + 30;
  const y1 = imgInfo.y + imgInfo.dh / 2;
  const x2 = x1 + 200;
  const y2 = y1;
  await page.mouse.move(x1, y1, { steps: 10 });
  await sleep(200);
  await page.mouse.down();
  await sleep(100);
  for (let i = 1; i <= 60; i++) {
    const t = i / 60;
    await page.mouse.move(x1 + t * (x2 - x1), y1 + t * (y2 - y1) + Math.sin(t * 6) * 2);
    await sleep(20);
  }
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(8000);

  // 抓 tk 数据
  const result = await page.evaluate(() => ({
    tkA: window.__tkA,  // xyList
    tkTouch: window.__tkTouch,  // touchList
    tkOutLen: window.__tkLastOut ? window.__tkLastOut.length : 0,
  }));
  console.log('\n=== xyList (A) ===');
  console.log('Length:', result.tkA ? result.tkA.length : 0);
  console.log('Content:', result.tkA ? decodeURIComponent(result.tkA).substring(0, 1500) : null);
  console.log('\n=== touchList ===');
  console.log('Length:', result.tkTouch ? result.tkTouch.length : 0);
  console.log('Content:', result.tkTouch ? result.tkTouch.substring(0, 1500) : null);
  console.log('\ntk output length:', result.tkOutLen);

  console.log('\n=== /check 响应 ===');
  for (const r of respLog) {
    try {
      const j = JSON.parse(r.body);
      console.log(`  ${r.url.split('/').pop()}: code=${j.code} tp=${j.tp} vt=${j.vt ? 'YES' : 'null'} msg=${j.message || j.msg || ''}`);
    } catch (e) {
      console.log(`  ${r.url.split('/').pop()}: ${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
