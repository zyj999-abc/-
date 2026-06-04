#!/usr/bin/env node
/**
 * 113_jcap_inspect_full_xyList.js
 *
 * 跑 112 类似流程，但完整抓 xyList 全部点
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

      const wCreateVariant = 'w=new(a["Cap"+e(533,561)+"aWe"+e(550,536)+e(548,521)+"bly"])(i)';
      if (body.includes(wCreateVariant)) {
        body = body.replace(wCreateVariant, wCreateVariant + ';window.__w=w;');
      }

      const tkVariants = [
        'tk:k([a,s,A,JSON.stringify(f)])',
        'tk: k([a, s, A, JSON.stringify(f)])',
        'tk: k([a,s,A,JSON.stringify(f)])',
      ];
      for (const v of tkVariants) {
        if (body.includes(v)) {
          body = body.replace(v, 'tk:((t)=>{try{window.__tkFullInput=t;window.__tkFullA=t[2];window.__tkFullTouch=t[3];var o=k(t);window.__tkFullOut=o;return o}catch(e){throw e}})([a,s,A,JSON.stringify(f)])');
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

  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  if (!imgInfo) { console.log('no cpc_img'); await browser.close(); return; }
  console.log('imgInfo:', JSON.stringify(imgInfo));

  // 画斜线（左下到右上）
  const startX = imgInfo.x + 30;
  const startY = imgInfo.y + imgInfo.dh - 30;
  const endX = imgInfo.x + imgInfo.dw - 30;
  const endY = imgInfo.y + 30;

  await page.mouse.move(startX, startY, { steps: 20 });
  await sleep(300);
  await page.mouse.down();
  await sleep(100);
  const N = 60;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = startX + ease * (endX - startX);
    const y = startY + ease * (endY - startY);
    await page.mouse.move(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2);
    await sleep(15 + Math.random() * 10);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(8000);

  // 抓完整 xyList
  const result = await page.evaluate(() => {
    let xyList = null;
    if (window.__tkFullA) {
      try {
        xyList = JSON.parse(decodeURIComponent(window.__tkFullA));
      } catch (e) { xyList = null; }
    }
    return {
      tkOutLen: window.__tkFullOut ? window.__tkFullOut.length : 0,
      xyList: xyList,
      touchList: window.__tkFullTouch ? JSON.parse(window.__tkFullTouch) : null,
    };
  });
  console.log('\n=== 完整 xyList ===');
  if (result.xyList) {
    console.log('x:', result.xyList.x, 'y:', result.xyList.y, 'ht:', result.xyList.ht, 'wt:', result.xyList.wt);
    console.log('list count:', result.xyList.list.length);
    console.log('前 5 个点:');
    for (let i = 0; i < Math.min(5, result.xyList.list.length); i++) {
      console.log('  ', result.xyList.list[i]);
    }
    console.log('最后 5 个点:');
    for (let i = Math.max(0, result.xyList.list.length - 5); i < result.xyList.list.length; i++) {
      console.log('  ', result.xyList.list[i]);
    }
    console.log('其他字段:', Object.keys(result.xyList).filter(k => k !== 'list' && k !== 'x' && k !== 'y' && k !== 'ht' && k !== 'wt'));
    for (const k of Object.keys(result.xyList).filter(k => k !== 'list' && k !== 'x' && k !== 'y' && k !== 'ht' && k !== 'wt')) {
      console.log(`  ${k}: ${result.xyList[k]}`);
    }
  }
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
