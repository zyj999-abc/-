#!/usr/bin/env node
/**
 * 99b_jcap_decode_in_browser.js
 *
 * 实际跑 jcap SDK 内部代码，console.log 出 k/x/M/F/N 函数实际调用的 w["getXXX"] 方法名
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
    const url = event.request.url;
    try {
      const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
      let body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf-8') : resp.body;
      console.log(`[PATCH] body len: ${body.length}`);

      // patch: 在 23206 行的 k 函数 return w[...] 前面加 console.log 暴露 w["getXXX"] 方法名
      // 找 k 函数体
      // 原: return w\n              ? w[\n                  "get" +\n                    (function (A, t) {\n                      return S(A - -399, t);\n                    })(473, 449) +\n                    e(210, 222)\n                ](A)
      // patch 替换中间为 console.log
      const kVariant = `k = function (A) {
          var t = {};
          function e(A, t) {
            return S(t - -608, A);
          }
          ((t.fnName = k[e(215, 225) + "e"]), b.record(t));
          try {
            return w
              ? w[
                  "get" +
                    (function (A, t) {
                      return S(A - -399, t);
                    })(473, 449) +
                    e(210, 222)
                ](A)
              : "";
          } catch (A) {
            return "";
          }
        },`;

      const kVariant2 = `k=function(A){var t={};function e(A,t){return S(t- -608,A)}return(t.fnName=k[e(215,225)+"e"],b.record(t)),w?w["get"+(function(A,t){return S(A- -399,t)})(473,449)+e(210,222)](A):""}`;

      // 直接找到 k=function 之后的 "get" + (function..) + e(210,222) 模式
      // 用更稳健的方式：在 "function (A, t) {\n                      return S(A - -399, t);\n                    })(473, 449) +" 后面加 console.log
      // 但 SDK 是 minified 单行，需要各种 variant
      const variants = [
        '})(473, 449) +\n                    e(210, 222)',
        '})(473,449)+e(210,222)',
        '})(473, 449)+e(210, 222)',
        '})(473,449) +e(210,222)',
      ];
      let matched = false;
      for (const v of variants) {
        if (body.includes(v)) {
          console.log(`[PATCH] matched k variant`);
          const repl = v + ' /*+ console.log("K_METHOD", "get" + (function(A,t){return S(A- -399,t)})(473,449) + e(210,222)) +*/';
          // 简单方式：在 w["get"... 调用前注入 console.log
          // 找 return w\n              ? w[\n                  "get" + ... + e(210,222)\n                ](A) 模式
          // 直接在 k 函数开头加 console.log 算
          break;
        }
      }

      // 更直接：在 k 函数定义开头加 window.__kInfo = {...}
      // 找 k=function 之后立刻在开头注入
      const kStartVariants = [
        'k=function(A){var t={};function e(A,t){return S(t- -608,A)}',
        'k=function(A){var t={};function e(A,t){return S(t--608,A)}',
      ];
      for (const v of kStartVariants) {
        if (body.includes(v)) {
          console.log(`[PATCH] matched k start variant`);
          // 替换：在 k 函数开头暴露关键信息
          const repl = v.replace('var t={};function e(A,t){return S(t- -608,A)}', 'var t={};function e(A,t){return S(t- -608,A)};var __kMethod="get"+(function(A,t){return S(A- -399,t)})(473,449)+e(210,222);console.log("K_METHOD", __kMethod);window.__kMethod=__kMethod;');
          body = body.replace(v, repl);
          break;
        }
      }

      // x 函数类似
      const xStartVariants = [
        'x=function(A){var t={};',
      ];
      for (const v of xStartVariants) {
        if (body.includes(v)) {
          const repl = v + 'var __xMethod=(function(A,t){return S(t- -356,A)})(467,491);console.log("X_METHOD", __xMethod+"CTData");window.__xMethod=__xMethod+"CTData";';
          body = body.replace(v, repl);
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
    if (t.includes('K_METHOD') || t.includes('X_METHOD') || t.includes('M_METHOD') || t.includes('F_METHOD') || t.includes('N_METHOD')) {
      console.log('[BROWSER]', t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 触发 jcap - 用真实 headed Chrome 输入触发
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

  // 多点几次
  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2000);
      const r = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
      if (r) { console.log('触发 click=' + i); break; }
    }
    await sleep(3000);
  }
  await sleep(5000);

  // 抓取方法名
  const result = await page.evaluate(() => {
    return {
      kMethod: window.__kMethod,
      xMethod: window.__xMethod,
    };
  });
  console.log('\n=== 方法名 ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
