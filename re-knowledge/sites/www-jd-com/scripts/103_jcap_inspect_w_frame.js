#!/usr/bin/env node
/**
 * 103_jcap_inspect_w_main_frame.js
 *
 * 触发 jcap 后切换到 jcap 的 iframe 上抓 w
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

      // 暴露 w 实例和 k 函数 (都打包到 window.__jcapW = w 之后)
      // 找 w = new(a["Cap...") 后立即: window.__w = w; window.__k = k;
      // k 函数和 w 在 var w=null, b=..., D=..., k=..., x=... 同一 var 声明中
      // 但 var 列表不能直接插入到中间
      // 方案: 在 (function(){})() 之后插入 setter
      // 找 }(mE.sPxgb)); })() - 这是 var D = ...; 的关闭
      // 然后 k=function(A){...}; x=function(A){...} 是独立赋值

      // 简单方案: 找 w = new(a["Cap" 后追加: ; window.__w = w;
      body = body.replace(/(w=new\(a\["Cap")/, ';window.__w=w;$1');

      // 同样把 k/x/M/F/N/R 函数都暴露到 window
      // k=function(A){var t={};function e(A,t){return S(t- -608,A)} 后面追加 ; window.__k = k;
      body = body.replace(/(k=function\(A\)\{var t=\{\};function e\(A,t\)\{return S\(t- -608,A\)\})/, '$1;window.__k=k;');
      body = body.replace(/(x=function\(A\)\{var t=\{\};function e\(A,t\)\{return S\(t- -356,A\)\})/, '$1;window.__x=x;');
      // M/F/N/R 形式不同
      body = body.replace(/(M=function\(A\)\{var t=\{\};function e\(A,t\)\{return S\(A- -303,t\)\})/, '$1;window.__M=M;');
      body = body.replace(/(F=function\(A\)\{var t=\{\};function e\(A,t\)\{return S\(t- -737,A\)\})/, '$1;window.__F=F;');
      body = body.replace(/(N=function\(A\)\{var t=\{\};function e\(A,t\)\{return S\(A- -1517,t\)\})/, '$1;window.__N=N;');
      body = body.replace(/(R=function\(A,t\)\{try\{return w\?w\[function\(A,t\)\{return S\(t- -187,A\)\}\(704,690\)\+"se"\])/, '$1;window.__R=R;');
      body = body.replace(/(G=function\(A,t,e\)\{var n=\{\};function r\(A,t\)\{return S\(A- -263,t\)\})/, '$1;window.__G=G;');

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
    if (t.includes('JCAP_') || t.includes('W_TYPE')) {
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
  await sleep(8000);  // 多等一会儿让 jcap 加载

  // 直接在 main page 上抓 (jcap 加载到主 window)
  console.log('\n=== Main page 信息 ===');
  try {
    const result = await page.evaluate(() => {
      const info = {
        url: window.location.href,
        hasW: !!window.__w,
        hasK: !!window.__k,
        hasX: !!window.__x,
        hasM: !!window.__M,
        hasF: !!window.__F,
        hasN: !!window.__N,
        hasR: !!window.__R,
        hasG: !!window.__G,
      };
      if (window.__w) {
        const w = window.__w;
        info.wCtor = w.constructor.name;
        info.wMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(w)).filter(n => typeof w[n] === 'function');
        info.hasGetTKData = typeof w.getTKData;
        info.hasParse = typeof w.parse;
        try {
          const r = w.getTKData(['MVRkpQABAAAClxJdgQoAMFN76uhRsoOJPpCFVIkruicHwFn7dgg9ZNvb1HdN8YsrEtR-lZJonCK65bdZAKMQZAAAAAA', 'PBKgbnYCxkPVW8qR', encodeURIComponent('{"test":1}'), '{}']);
          info.tkTest = { type: typeof r, len: r ? r.length : 0, sample: r ? r.substring(0, 100) : null };
        } catch (e) { info.tkTest = 'err: ' + e.message; }
        try {
          const r = w.getCTData(['MVRkpQABAAAClxJdgQoAMFN76uhRsoOJPpCFVIkruicHwFn7dgg9ZNvb1HdN8YsrEtR-lZJonCK65bdZAKMQZAAAAAA', { test: 1 }]);
          info.ctTest = { type: typeof r, len: r ? r.length : 0 };
        } catch (e) { info.ctTest = 'err: ' + e.message; }
      }
      if (window.__k) {
        info.kType = typeof window.__k;
        try {
          const r = window.__k(['test_si', 'test_st', 'test_xyList', '{}']);
          info.kTest = { type: typeof r, len: r ? r.length : 0 };
        } catch (e) { info.kTest = 'err: ' + e.message; }
      }
      return info;
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('main eval error:', e.message);
  }

  // 检查所有 frame
  const allFrames = page.frames();
  console.log('\n所有 frame:', allFrames.length);
  for (const f of allFrames) {
    console.log('  Frame URL:', f.url());
  }

  await browser.close();
})();
