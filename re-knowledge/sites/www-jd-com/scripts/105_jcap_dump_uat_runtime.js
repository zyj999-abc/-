#!/usr/bin/env node
/**
 * 105_jcap_dump_uat_runtime.js
 *
 * 在 jcap SDK 加载后，dump 实际运行时 U 数组 + S 函数返回值
 * 确认 99e 跑出的 K_METHOD="getTKData" 是怎么算出来的
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

      // 注入：在 k 函数开始时 dump 各种运行时数据
      const kVariant = 'k=function(A){var t={};function e(A,t){return S(t- -608,A)}';
      if (body.includes(kVariant)) {
        const dumpCode = `
          try {
            // 在 k 函数中：S, e 都是局部的
            // S(872, 449) 实际值
            var __S872_449 = S(872, 449);
            // e(210, 222) 实际值
            var __e210_222 = e(210, 222);
            // _(262, 449) 实际值（直接调 _）
            var __u262 = _(262, 449);
            // _(220, 210) 实际值
            var __u220 = _(220, 210);
            // U 数组实际值 - 用一个间接方法：试着调用 U() 看返回
            // 但 U 可能是 function declaration，引用困难
            // 用 _ 函数源码找到 closure 中的 e 变量
            window.__kDump = {
              S872_449: __S872_449,
              e210_222: __e210_222,
              u262: __u262,
              u220: __u220,
              S_872_449_combined: __S872_449 + __e210_222,
            };
            console.log('K_DUMP', JSON.stringify(window.__kDump));
          } catch(err) {
            console.log('K_DUMP_ERR', err.message);
          }
        `;
        body = body.replace(kVariant, kVariant + dumpCode);
      }

      // 让 w 实例暴露
      const wCreateVariant = 'w=new(a["Cap"+e(533,561)+"aWe"+e(550,536)+e(548,521)+"bly"])(i)';
      if (body.includes(wCreateVariant)) {
        body = body.replace(wCreateVariant, 'w=new(a["Cap"+e(533,561)+"aWe"+e(550,536)+e(548,521)+"bly"])(i);window.__w=w;');
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
    if (t.startsWith('K_DUMP') || t.startsWith('K_DUMP_ERR')) {
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
  await sleep(3000);

  // 抓 w 的所有属性
  const result = await page.evaluate(() => {
    const out = { kDump: window.__kDump, wType: typeof window.__w };
    if (window.__w) {
      const w = window.__w;
      out.wCtor = w.constructor && w.constructor.name;
      out.wMethods = [];
      try {
        for (const k of Object.getOwnPropertyNames(w)) {
          if (typeof w[k] === 'function') out.wMethods.push(k);
        }
        const proto = Object.getPrototypeOf(w);
        if (proto) {
          out.protoMethods = [];
          for (const k of Object.getOwnPropertyNames(proto)) {
            if (typeof proto[k] === 'function') out.protoMethods.push(k);
          }
        }
      } catch(e) { out.err = e.message; }
    }
    return out;
  });
  console.log('\n=== Runtime data ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
