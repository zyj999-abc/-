#!/usr/bin/env node
/**
 * 99d_jcap_w_track.js
 *
 * 通过 CDP Fetch patch jcap SDK，让 w 实例暴露到 window.__jcapW
 * 然后通过真实触发，捕获 w["getTKData"] 和 w["getCTData"] 的实际输出
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

      // Patch 1: 暴露 w 实例
      // 用 Object.defineProperty 在 window 上加 getter
      // var w=null, → var w=null; Object.defineProperty(window, "__wRef", { get: function() { return w; } });
      let p1 = body;
      p1 = p1.replace(/var w=null,/, 'var w=null;Object.defineProperty(window,"__wRef",{get:function(){return w}});');
      console.log(`[PATCH] defineProperty for w: ${(p1.match(/__wRef/g) || []).length}`);

      // Patch 2: 找 w=new a[..] 形式 (不需要括号)
      p1 = p1.replace(/w=new\(/g, 'w=new(');
      // 同样加 defineProperty
      p1 = p1.replace(/w=new\(a\["Cap"/, 'w=new(a["Cap"');  // 不动
      console.log(`[PATCH] w=new retained`);

      // Patch 4: 在 SDK 头部注入 setter 监控
      // 在最后 `}return __webpack_exports__;` 之前注入
      // 或直接在最后 `}));` 之后注入
      const hook = `
;
;(function(){
  try {
    console.log('JCAP_HOOK_RAN, window.__w=' + (typeof window.__w));
    if (window.__w) {
      var methods = [];
      for (var k in window.__w) {
        if (typeof window.__w[k] === 'function') methods.push(k);
      }
      console.log('JCAP_METHODS ' + JSON.stringify(methods));
      window.__jcapMethods = methods;
    } else {
      console.log('JCAP_NO_W');
    }
  } catch(e) {
    console.log('JCAP_HOOK_ERR ' + e.message + ' / ' + e.stack);
  }
})();
`;

      // 找到 `__webpack_require__.d(__webpack_exports__,` 这种 export 形式
      // 找 `return __webpack_exports__` 之类
      // 简单：在 })() 之前 (即 IIFE 调用前) 注入
      // 找 ", CaptchaWebAssembly);" 或 ".a=CaptchaWebAssembly;"
      // 实际: `, CaptchaWebAssembly)` 是 webpack export 末尾

      // 找 "var w=null," 然后在它之后注入 hook
      p1 = p1.replace(/(var w=null,)/, '$1\n' + hook);
      console.log(`[PATCH] hook injected after var w=null,`);

      // 返回
      const newBody = Buffer.from(p1, 'utf-8').toString('base64');
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
    if (t.includes('JCAP_') || t.includes('TK_') || t.includes('CT_')) {
      console.log('[BROWSER]', t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 触发 jcap 加载 - 必须触发 captcha 创建才能让 w 被赋值
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
    for (const ch of text) {
      await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
    }
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

  // 抓取 w 实例方法
  const result = await page.evaluate(() => {
    let w = null;
    try { w = window.__wRef; } catch (e) { return { err: e.message }; }
    if (!w) return { error: 'no w (wRef is ' + typeof window.__wRef + ')' };
    const methods = [];
    for (const k in w) {
      if (typeof w[k] === 'function') methods.push(k);
    }
    return { methods, wType: w.constructor.name, methods2: Object.getOwnPropertyNames(w).slice(0, 30) };
  });
  console.log('\n=== W 实例方法 ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
