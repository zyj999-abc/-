#!/usr/bin/env node
/**
 * 99c_jcap_decode_all_methods.js
 *
 * 通过 CDP Fetch patch jcap SDK，在所有 k/x/M/F/N/R/G 函数定义开头注入 console.log
 * 暴露 w["getXXX"] 方法名
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

      // 计算每个函数调用 w["getXXX"] 的方法名
      // 注入 hook 脚本：在脚本顶部把 e/S/_(A,t) 函数包装暴露
      // 在模块最后注入 function call hook

      // 方案：直接在脚本末尾注入调用代码，模拟每个函数调用一次
      // 先把这些函数原样保留，然后添加一个__jcapHook全局对象

      // 用更简单方法：在 k/x/M/F/N/R/G 函数定义中找 "try {" 之后加 console.log
      // k 函数 (minified): "k=function(A){var t={};function e(A,t){return S(t- -608,A)}(t.fnName=k[e(215,225)+\"e\"],b.record(t)),w?w[\"get\"+(function(A,t){return S(A- -399,t)})(473,449)+e(210,222)](A):\"\"}"
      // 找 "k=function(A)" 然后在它之后第一个分号前注入 console.log
      // 不容易，因为是单行

      // 改方案：让 SDK 执行时，原 k 函数调用 w["getXXX"](A) 时打印
      // w 是 CaptchaWebAssembly 实例，捕获对 w 的 getOwnPropertyDescriptor 即可

      // 最简方案：在末尾 (function(){}();) 注入 wrapper
      // 找出 SDK 的尾部 self-invocation，再附加代码

      // 实际上 SDK 头部有 `__webpack_require__.r(__webpack_exports__)` 之类的加载
      // SDK 是 IIFE: !function(A,t){...}(window, function(){...}) 形式
      // 在 IIFE 末尾注入能访问内部 w, k, x, M, F, N, R, G

      // 找到最后 `}(_, S, U);` 之类的 close 模式
      // 让我搜 SDK 末尾特征

      const endPattern = ')()';
      const lastIdx = body.lastIndexOf(')();');
      console.log(`[PATCH] last )() idx: ${lastIdx}`);

      // 找到 IIFE 的实际结尾
      // SDK 文本以 `, CaptchaWebAssembly);` 或 `)(window, fn);` 结尾
      // 找到 `})(window, function() { ... })` 模式

      // 简便：在 body 末尾追加 "window.__JcapHook = { k: k, x: x, M: M, F: F, N: N, R: R, G: G, w: w };"
      // 但 w 在外层 IIFE 内可访问

      // 改：在最末尾 `})(window, function() {...})` 后面紧接 `window.__JcapHook = ...`
      // 找 `.default = CaptchaWebAssembly;` 或类似 (SDK export 标志)

      // 直接试末尾追加
      const hook = `
;
;(function(){
  try {
    if (typeof w !== 'undefined') {
      window.__jcapW = w;
      // 枚举 w 的所有方法
      var methods = [];
      for (var k in w) {
        if (typeof w[k] === 'function') methods.push(k);
      }
      window.__jcapMethods = methods;
      console.log('JCAP_METHODS ' + JSON.stringify(methods));
    }
    if (typeof k !== 'undefined') {
      window.__jcapK = k;
      console.log('JCAP_K_TYPE ' + typeof k);
    }
    if (typeof x !== 'undefined') {
      window.__jcapX = x;
    }
    if (typeof w !== 'undefined') {
      // 测试调用
      try {
        var tkResult = w.getTKData(['test_si','test_st','test_xyList','{}']);
        console.log('TK_TEST ' + (typeof tkResult) + ' len=' + (tkResult ? tkResult.length : 0));
        window.__jcapTkTest = tkResult;
      } catch(e) { console.log('TK_TEST_ERR ' + e.message); }
      try {
        var ctResult = w.getCTData(['test_si', {}]);
        console.log('CT_TEST ' + (typeof ctResult) + ' len=' + (ctResult ? ctResult.length : 0));
      } catch(e) { console.log('CT_TEST_ERR ' + e.message); }
    }
  } catch(e) {
    console.log('JCAP_HOOK_ERR ' + e.message);
  }
})();
`;
      // 把 hook 注入 body 末尾
      // body 末尾通常是 `})({});` 之类
      body = body + hook;

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
    if (t.includes('JCAP_') || t.includes('TK_') || t.includes('CT_')) {
      console.log('[BROWSER]', t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 抓取 w 实例方法
  const result = await page.evaluate(() => {
    return {
      methods: window.__jcapMethods,
      kType: window.__jcapK && typeof window.__jcapK,
      tkTest: window.__jcapTkTest && {
        type: typeof window.__jcapTkTest,
        len: window.__jcapTkTest.length,
        sample: window.__jcapTkTest.substring(0, 100),
      },
    };
  });
  console.log('\n=== W 实例方法 ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
