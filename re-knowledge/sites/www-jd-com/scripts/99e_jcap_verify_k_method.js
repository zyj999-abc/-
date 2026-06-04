#!/usr/bin/env node
/**
 * 99e_jcap_verify_k_method.js
 *
 * 触发 jcap，在 SDK 内部用 console.log 验证 k/x 函数实际调用的 w["getXXX"] 方法名
 * 用更直接的方式：在 SDK 头部注入测试代码
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

      // Patch 1: 找 k=function(A) 后在开头注入 console.log
      const kVariants = [
        'k=function(A){var t={};function e(A,t){return S(t- -608,A)}',
        'k=function(A){var t={};function e(A,t){return S(t--608,A)}',
      ];
      for (const v of kVariants) {
        if (body.includes(v)) {
          console.log(`[PATCH] matched k start variant`);
          // 注入计算
          const repl = v + 'try{var __kMethod="get"+(function(A,t){return S(A- -399,t)})(473,449)+e(210,222);console.log("K_METHOD",__kMethod,"K_S_NAME",S.toString().substring(0,200),"K_E_NAME",e.toString().substring(0,200));window.__kMethod=__kMethod;window.__KSName=S.toString().substring(0,200);window.__KEName=e.toString().substring(0,200);}catch(e){console.log("K_ERR",e.message);window.__kErr=e.message;}';
          body = body.replace(v, repl);
          break;
        }
      }

      // Patch 2: x 函数
      const xVariants = [
        'x=function(A){var t={};',
      ];
      for (const v of xVariants) {
        if (body.includes(v)) {
          const repl = v + 'try{var __xMethod=(function(A,t){return S(t- -356,A)})(467,491)+"CTData";console.log("X_METHOD",__xMethod);window.__xMethod=__xMethod;}catch(e){}';
          body = body.replace(v, repl);
          break;
        }
      }

      // Patch 3: M 函数
      const mVariants = [
        'M=function(A){var t={};function e(A,t){return S(A- -303,t)}',
        'M=function(A){var t={};function e(A,t){return S(A--303,t)}',
      ];
      for (const v of mVariants) {
        if (body.includes(v)) {
          const repl = v + 'try{var __mMethod=e(1150,1157)+"SEData";console.log("M_METHOD",__mMethod);window.__mMethod=__mMethod;}catch(e){}';
          body = body.replace(v, repl);
          break;
        }
      }

      // Patch 4: F 函数
      const fVariants = [
        'F=function(A){',
      ];
      for (const v of fVariants) {
        if (body.includes(v)) {
          const repl = v + 'try{var __fMethod="getCSD"+(function(A,t){return S(t- -737,A)})(96,93);console.log("F_METHOD",__fMethod);window.__fMethod=__fMethod;}catch(e){}';
          body = body.replace(v, repl);
          break;
        }
      }

      // Patch 5: N 函数 (getInitialSt)
      const nVariants = [
        'N=function(A){var t={};((t.fnName=N.name),b.record(t))',
      ];
      for (const v of nVariants) {
        if (body.includes(v)) {
          const repl = v + 'try{var __nMethod="getInitialSt"+(function(A,t){return S(A- -1517,t)})(-653,-679);console.log("N_METHOD",__nMethod);window.__nMethod=__nMethod;}catch(e){}';
          body = body.replace(v, repl);
          break;
        }
      }

      // Patch 6: R 函数 (parse) - 精确匹配 jcap 的 R 函数
      const rVariants = [
        'R=function(A,t){try{return w?w[function(A,t){return S(t- -187,A)}(704,690)+"se"](A,t):{}}catch(A){return{}}}',
      ];
      for (const v of rVariants) {
        if (body.includes(v)) {
          const repl = v.replace('R=function(A,t){try{', 'R=function(A,t){try{var __rMethod=(function(A,t){return S(t- -187,A)})(704,690)+"se";console.log("R_METHOD",__rMethod,"S_NAME",S.toString().substring(0,200));window.__rMethod=__rMethod;window.__SName=S.toString().substring(0,200);');
          body = body.replace(v, repl);
          break;
        }
      }

      // Patch 7: G 函数 (trace)
      const gVariants = [
        'G=function(A,t,e){var n={};function r(A,t){return S(A- -263,t)}',
      ];
      for (const v of gVariants) {
        if (body.includes(v)) {
          const repl = v + 'try{var __gMethod="tra"+(function(A,t){return S(t- -433,A)})(432,443)+r(574,577);console.log("G_METHOD",__gMethod);window.__gMethod=__gMethod;}catch(e){}';
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
    if (/^[KMFNRG]_METHOD|^[KMFNRG]_ERR/.test(t)) {
      console.log('[BROWSER]', t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 触发 jcap 加载
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
  await sleep(3000);

  // 抓取所有方法名
  const result = await page.evaluate(() => ({
    kMethod: window.__kMethod,
    kErr: window.__kErr,
    xMethod: window.__xMethod,
    mMethod: window.__mMethod,
    fMethod: window.__fMethod,
    nMethod: window.__nMethod,
    rMethod: window.__rMethod,
    gMethod: window.__gMethod,
  }));
  console.log('\n=== 所有方法名 ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
