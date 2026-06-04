#!/usr/bin/env node
/**
 * 108_jcap_replay_getTKData.js
 *
 * 触发 jcap 后，把 tk 输入 dump 出来
 * 然后在浏览器中**直接**调用 w.getTKData(input) 验证是否产生同样的输出
 * 看是否可独立复用
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
      console.log('Fetch error:', e.message);
      try { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); } catch (_) {}
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
  if (!triggered) { console.log('未触发'); await browser.close(); return; }
  await sleep(5000);

  // 用 page.evaluate 在浏览器中**直接调用 w.getTKData** 测试
  console.log('\n=== 测试直接调用 w.getTKData ===');
  const test1 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.getTKData !== 'function') return { err: 'no getTKData' };
    try {
      // 用最简单的输入试
      var out = window.__w.getTKData(['test_si', 'test_st', '', '{"touchList":[]}']);
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message, stack: e.stack }; }
  });
  console.log('Test1 (minimal input):', JSON.stringify(test1));

  // 测试更详细的输入
  const test2 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.getCTData !== 'function') return { err: 'no getCTData' };
    try {
      var out = window.__w.getCTData(['test_si', '{"account":"test","uo":"{}","capfp":"test"}']);
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test2 (getCTData):', JSON.stringify(test2));

  // 测试 getCSData
  const test3 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.getCSData !== 'function') return { err: 'no getCSData' };
    try {
      var out = window.__w.getCSData(['test_si', '{"d":"test"}']);
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test3 (getCSData):', JSON.stringify(test3));

  // 测试 parse
  const test4 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.parse !== 'function') return { err: 'no parse' };
    try {
      var out = window.__w.parse('test_input', 'test_format');
      return { ok: true, type: typeof out, keys: out ? Object.keys(out) : null, sample: out ? JSON.stringify(out).substring(0, 200) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test4 (parse):', JSON.stringify(test4));

  // 测试 getXcr
  const test5 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.getXcr !== 'function') return { err: 'no getXcr' };
    try {
      var out = window.__w.getXcr('test_input');
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test5 (getXcr):', JSON.stringify(test5));

  // 测试 getPoW
  const test6 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.getPoW !== 'function') return { err: 'no getPoW' };
    try {
      var out = window.__w.getPoW('test_input');
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test6 (getPoW):', JSON.stringify(test6));

  // 测试 getSEData
  const test7 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.getSEData !== 'function') return { err: 'no getSEData' };
    try {
      var out = window.__w.getSEData('test_input');
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test7 (getSEData):', JSON.stringify(test7));

  // 测试 getInitialState
  const test8 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.getInitialState !== 'function') return { err: 'no getInitialState' };
    try {
      var out = window.__w.getInitialState('test_input');
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test8 (getInitialState):', JSON.stringify(test8));

  // 测试 transform
  const test9 = await page.evaluate(() => {
    if (!window.__w) return { err: 'no w' };
    if (typeof window.__w.transform !== 'function') return { err: 'no transform' };
    try {
      var out = window.__w.transform('test_input');
      return { ok: true, type: typeof out, length: out ? out.length : 0, sample: out ? out.substring(0, 100) : null };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Test9 (transform):', JSON.stringify(test9));

  await browser.close();
})();
