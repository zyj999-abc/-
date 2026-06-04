#!/usr/bin/env node
/**
 * 109_jcap_test_no_drag.js
 *
 * 触发 jcap 后**不**画轨迹，立即看 /check 响应
 * 验证 16807 是否是轨迹问题还是其他问题
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

  // 拦截所有 /check 和 /verify 响应
  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/api/check') || url.includes('/api/verify') || url.includes('/api/fp')) {
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

  // 立即模拟简单拖动但不画复杂路径
  let imgInfo;
  try {
    imgInfo = await page.evaluate(() => {
      const cpc = document.querySelector('#cpc_img');
      if (!cpc) return null;
      const r = cpc.getBoundingClientRect();
      return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
    });
  } catch(e) { console.log('imgInfo error:', e.message); }
  console.log('imgInfo:', JSON.stringify(imgInfo));

  if (!imgInfo) { console.log('no cpc_img'); await browser.close(); return; }

  // 简单水平拖动 200 像素
  const x1 = imgInfo.x + 30;
  const y1 = imgInfo.y + imgInfo.dh / 2;
  const x2 = x1 + 200;
  const y2 = y1;
  await page.mouse.move(x1, y1, { steps: 10 });
  await sleep(200);
  await page.mouse.down();
  await sleep(100);
  for (let i = 1; i <= 30; i++) {
    const t = i / 30;
    await page.mouse.move(x1 + t * (x2 - x1), y1 + t * (y2 - y1) + Math.sin(t * 4) * 3);
    await sleep(30);
  }
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(8000);

  // 输出所有响应
  console.log('\n=== 所有 /check /verify /fp 响应 ===');
  for (const r of respLog) {
    const ep = r.url.split('/').pop();
    let parsed;
    try { parsed = JSON.parse(r.body); } catch (e) { parsed = null; }
    if (parsed) {
      console.log(`  ${ep}: code=${parsed.code} tp=${parsed.tp} vt=${parsed.vt ? 'YES('+parsed.vt.length+' chars)' : 'null'} msg=${parsed.message || parsed.msg || ''}`);
    } else {
      console.log(`  ${ep}: raw=${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
