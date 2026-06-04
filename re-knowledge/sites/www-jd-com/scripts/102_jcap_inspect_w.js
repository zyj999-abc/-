#!/usr/bin/env node
/**
 * 102_jcap_inspect_w_runtime.js
 *
 * 触发 jcap，在 SDK 实际执行后捕获 w 实例的：
 * - constructor name
 * - 所有可枚举方法
 * - prototype 链
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
      console.log(`[PATCH] body len: ${body.length}`);

      // Patch: 在 w = new a[...] 后面暴露 w
      const variants = [
        'w = new a["Cap"',
        'w=new(a["Cap"',
        'w = new a["Cap"',
      ];
      for (const v of variants) {
        if (body.includes(v)) {
          console.log(`[PATCH] matched w assign: ${v}`);
          // 替换为: window.__w = w = new a[...]
          body = body.replace(v, 'window.__w=w=' + v);
          break;
        }
      }

      // 返回
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
    if (t.includes('JCAP_W') || t.includes('TK_') || t.includes('CT_')) {
      console.log('[BROWSER]', t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 触发 jcap
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
      const r = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
      if (r) { console.log('触发 click=' + i); triggered = true; break; }
    }
    if (triggered) break;
    await sleep(3000);
  }
  await sleep(5000);

  // 抓取 w 实例
  const result = await page.evaluate(() => {
    const w = window.__w;
    if (!w) return { error: 'no w' };
    const info = {
      constructor: w.constructor.name,
      ctorStr: w.constructor.toString().substring(0, 200),
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(w)),
      hasGetTKData: typeof w.getTKData,
      hasGetCTData: typeof w.getCTData,
      hasParse: typeof w.parse,
      tryGetTKData: null,
    };
    try {
      info.tryGetTKData = String(w.getTKData(['test_si', 'test_st', 'test_xyList', '{}']));
    } catch (e) {
      info.tryGetTKData = 'err: ' + e.message;
    }
    return info;
  });
  console.log('\n=== W 实例信息 ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
