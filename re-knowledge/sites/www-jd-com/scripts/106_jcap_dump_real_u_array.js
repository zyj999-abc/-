#!/usr/bin/env node
/**
 * 106_jcap_dump_real_u_array.js
 *
 * 浏览器中加载 jcap SDK 后，从 _ 函数 / U 数组的实际 closure 抓真实 U 数组
 * 用 CDP Fetch 注入代码，在 SDK 加载完成后立即 dump U 数组
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
      console.log('[PATCH] body len:', body.length);

      // 在 jcap 主 _ 函数定义后注入 dump 代码
      // jcap 主 _ 函数体：function _(A,t){var e=U();return _=function(t,n){...}, _(A,t)}
      const target = ',_(A,t)';
      const idx = body.lastIndexOf(target);
      console.log('[PATCH] lastIndexOf target:', idx);
      if (idx > 0) {
        const dumpCode = `
          // 抓 closure 中的 e 数组（即 U() 的返回值）
          try {
            // _ 函数 closure 中 e 不可直接访问，但可以通过 e[0] 间接试探
            // 实际方法：调用 _(0, 0) 看 e[?] 是啥
            var __r0 = _(0, 0);
            var __r1 = _(1, 0);
            var __r2 = _(2, 0);
            var __r220 = _(220, 0);
            var __r262 = _(262, 0);
            var __r446 = _(446, 0);
            var __r659 = _(659, 0);

            // 调用 _ 函数的 0..450 索引
            window.__uDump = [];
            for (var __i = 213; __i < 268; __i++) {
              try { window.__uDump.push([__i, _(__i, 0)]); } catch(e) { window.__uDump.push([__i, 'ERR:' + e.message]); }
            }

            // 整个 U 数组（最大 60 元素）通过循环获取
            window.__uArr = [];
            for (var __i = 213; __i < 273; __i++) {
              try { window.__uArr.push(_(__i, 0)); } catch(e) { window.__uArr.push(null); }
            }

            console.log('U_DUMP', JSON.stringify({r0: __r0, r1: __r1, r2: __r2, r220: __r220, r262: __r262, r446: __r446, r659: __r659, arr: window.__uArr, dump: window.__uDump}));
          } catch(err) {
            console.log('U_DUMP_ERR', err.message);
          }
        `;
        // 找最后一处 ",_(A,t)" 注入（即 jcap 主 _ 函数结束处）
        body = body.substring(0, idx) + ',_(A,t);' + dumpCode + body.substring(idx + target.length);
        console.log('[PATCH] injected dump code at idx', idx);
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
    if (t.startsWith('U_DUMP') || t.startsWith('U_DUMP_ERR')) {
      console.log('[BROWSER]', t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(5000);

  // 此时 SDK 已加载，dump 数据在 window.__uDump 中
  const result = await page.evaluate(() => ({
    uDump: window.__uDump,
    uArr: window.__uArr,
  }));
  console.log('\n=== U 数组实际运行时值 ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
