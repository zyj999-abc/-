#!/usr/bin/env node
/**
 * 97_jcap_k_debugger.js
 *
 * 在 jcap SDK 加载之前 patch SDK 文本，注入 debugger;
 * 触发验证码时，tk 计算会触发断点。
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
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

  // 用 CDP fetch 拦截 jcap SDK，在响应中 patch 加 debugger
  const cdp = await page.target().createCDPSession();
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*jcap_ujb96b.js*', requestStage: 'Response' }],
  });

  await cdp.on('Fetch.requestPaused', async (event) => {
    const url = event.request.url;
    try {
      // 拿响应体
      const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
      let body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf-8') : resp.body;
      // patch: 在 k = function (A) 后面加 debugger; 在 tk: k( 前面也加
      // 在 "tk: k([" 后面插一行 `console.log('TK_INPUT', JSON.stringify(arguments[0]));`
      // 在 "tk: k([a, s, A, JSON.stringify(f)])" 中 k 调用前 hook
      // 在 "k([a, s, A, JSON.stringify(f)])" 替换为 `((tkInput) => { console.log('TK_INPUT', JSON.stringify(tkInput)); return k(tkInput); })([a, s, A, JSON.stringify(f)])`
      // 同样在 x 和 F
      const orig = "tk: k([a, s, A, JSON.stringify(f)])";
      const repl = "tk: ((tkInput) => { try { var tkOut = k(tkInput); window.__tkOuts = window.__tkOuts || []; window.__tkOuts.push({in: tkInput, out: tkOut}); window.__lastTkInput = tkInput; window.__lastTkOut = tkOut; } catch(e) { window.__tkErrs = window.__tkErrs || []; window.__tkErrs.push(e.message); throw e; } return tkOut; })([a, s, A, JSON.stringify(f)])";
      console.log(`[PATCH] tk found: ${body.includes(orig)}, body len: ${body.length}`);
      // 试多种空白模式
      const variants = [
        'tk: k([a, s, A, JSON.stringify(f)])',
        'tk:k([a,s,A,JSON.stringify(f)])',
        'tk: k([a,s,A,JSON.stringify(f)])',
        'tk:k([a, s, A, JSON.stringify(f)])',
      ];
      for (const v of variants) {
        if (body.includes(v)) {
          console.log(`[PATCH] matched variant: ${JSON.stringify(v)}`);
          body = body.replace(v, repl);
          break;
        }
      }
      body = body.replace(orig, repl);
      // CS 多种形式
      const csVariants = [
        'cs: F([a, JSON.stringify(p)])',
        'cs:F([a,JSON.stringify(p)])',
        'cs: F([a,JSON.stringify(p)])',
        'cs:F([a, JSON.stringify(p)])',
      ];
      for (const v of csVariants) {
        if (body.includes(v)) {
          console.log(`[PATCH] matched CS variant: ${JSON.stringify(v)}`);
          body = body.replace(v, `cs: ((fInput) => { try { console.log('CS_INPUT ' + JSON.stringify(fInput)); window.__lastCsInput = fInput; } catch(e) {} return F(fInput); })([a, JSON.stringify(p)])`);
          break;
        }
      }
      // CT 多种形式
      const ctVariants = [
        'ct: x([a, C])',
        'ct:x([a,C])',
        'ct: x([a,C])',
        'ct:x([a, C])',
      ];
      for (const v of ctVariants) {
        if (body.includes(v)) {
          console.log(`[PATCH] matched CT variant: ${JSON.stringify(v)}`);
          body = body.replace(v, `ct: ((xInput) => { try { console.log('CT_INPUT ' + JSON.stringify(xInput)); window.__lastCtInput = xInput; } catch(e) {} return x(xInput); })([a, C])`);
          break;
        }
      }
      // 返回修改后的 body
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

  // 抓 console
  page.on('console', m => {
    const t = m.text();
    if (t.startsWith('TK_INPUT') || t.startsWith('CT_INPUT') || t.startsWith('CS_INPUT')) {
      console.log(t);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

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

  const ts = Date.now().toString().slice(-8);
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
    await sleep(5000);
  }
  if (!triggered) { console.log('未触发'); await browser.close(); return; }
  await sleep(3000);

  // 抓 cpc_img
  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  if (!imgInfo) { console.log('no cpc_img'); await browser.close(); return; }

  // 画对角线
  const x1 = imgInfo.x + 20;
  const y1 = imgInfo.y + 20;
  const x2 = imgInfo.x + imgInfo.dw - 20;
  const y2 = imgInfo.y + imgInfo.dh - 20;
  await page.mouse.move(x1, y1, { steps: 10 });
  await sleep(200);
  await page.mouse.down();
  await sleep(100);
  for (let i = 1; i <= 30; i++) {
    const t = i / 30;
    await page.mouse.move(x1 + t * (x2 - x1), y1 + t * (y2 - y1));
    await sleep(30);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(10000);

  // 抓 tk/ct/cs input
  const result = await page.evaluate(() => {
    return {
      tk: window.__lastTkInput,
      tkOut: window.__lastTkOut,
      tkOuts: window.__tkOuts,
      tkErrs: window.__tkErrs,
      ct: window.__lastCtInput,
      cs: window.__lastCsInput,
    };
  });
  console.log('\n=== Last tk input ===');
  console.log(JSON.stringify(result, null, 2).substring(0, 4000));

  await browser.close();
})();
