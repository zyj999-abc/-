#!/usr/bin/env node
/**
 * 98_jcap_k_oracle.js
 *
 * 反复抓 k 函数输入输出，看是否纯函数、是否有时间戳影响。
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

  const cdp = await page.target().createCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*jcap_ujb96b.js*', requestStage: 'Response' }] });

  await cdp.on('Fetch.requestPaused', async (event) => {
    try {
      const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
      let body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf-8') : resp.body;
      // 包装 k 和 x
      const tkVariants = ['tk:k([a,s,A,JSON.stringify(f)])', 'tk: k([a, s, A, JSON.stringify(f)])'];
      for (const v of tkVariants) {
        if (body.includes(v)) {
          body = body.replace(v, `tk: ((tkInput) => { try { var tkOut = k(tkInput); window.__tkOuts = window.__tkOuts || []; window.__tkOuts.push({in: tkInput, out: tkOut}); } catch(e) { window.__tkErrs = window.__tkErrs || []; window.__tkErrs.push(e.message); throw e; } return tkOut; })([a, s, A, JSON.stringify(f)])`);
          break;
        }
      }
      const ctVariants = ['ct:x([a,C])', 'ct: x([a, C])'];
      for (const v of ctVariants) {
        if (body.includes(v)) {
          body = body.replace(v, `ct: ((xInput) => { try { var xOut = x(xInput); window.__ctOuts = window.__ctOuts || []; window.__ctOuts.push({in: xInput, out: xOut}); } catch(e) { window.__ctErrs = window.__ctErrs || []; window.__ctErrs.push(e.message); throw e; } return xOut; })([a, C])`);
          break;
        }
      }
      const newBody = Buffer.from(body, 'utf-8').toString('base64');
      await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: event.responseHeaders, body: newBody });
    } catch (e) {
      try { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); } catch (_) {}
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

  // 画两次相同轨迹，看 tk 是否一致
  const drawLine = async () => {
    const imgInfo = await page.evaluate(() => {
      const cpc = document.querySelector('#cpc_img');
      if (!cpc) return null;
      const r = cpc.getBoundingClientRect();
      return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
    });
    if (!imgInfo) return;
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
  };

  // 第一次绘制
  await drawLine();
  console.log('第一次绘制 done');
  await sleep(8000);

  // 重置 tkOuts 后第二次绘制
  await page.evaluate(() => { window.__tkOuts = []; window.__ctOuts = []; });
  await drawLine();
  console.log('第二次绘制 done');
  await sleep(8000);

  // 抓结果
  const result = await page.evaluate(() => ({
    tkOuts: window.__tkOuts,
    ctOuts: window.__ctOuts,
  }));
  console.log('\n=== tkOuts (前 4 个) ===');
  for (let i = 0; i < Math.min(4, result.tkOuts.length); i++) {
    const o = result.tkOuts[i];
    console.log(`  [${i}] in[1]=${o.in[1].substring(0,20)} in[3].length=${o.in[3].length} out.len=${o.out.length}`);
    console.log(`      out[0..50]=${o.out.substring(0, 80)}`);
  }
  console.log('\n=== ctOuts (前 4 个) ===');
  for (let i = 0; i < Math.min(4, result.ctOuts.length); i++) {
    const o = result.ctOuts[i];
    console.log(`  [${i}] out.len=${o.out.length}`);
  }

  await browser.close();
})();
