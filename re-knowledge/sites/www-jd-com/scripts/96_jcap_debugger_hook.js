#!/usr/bin/env node
/**
 * 96_jcap_debugger_hook.js
 *
 * 用 Chrome DevTools Protocol 设置条件断点 trace jcap k 函数调用。
 * 当 jcap submit /api/check 时，截取调用栈和 tk 输入输出。
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

  // hook 网络 /api/check
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Debugger.enable');

  // 等待 jcap 加载完成后 hook
  // 我们在 evaluateOnNewDocument 中 hook XMLHttpRequest 拿 /api/check body
  // 同时 hook fetch 和 XHR.send

  // 设置 breakpoint on text for jcap submit
  // jcap SDK 在 25258 行有 tk: k([a, s, A, JSON.stringify(f)])
  // 但我们没法直接定位，需要在 jcap 加载后用 evaluate 注入

  // 简化方案：监听所有 network 响应 /api/check 拿 body
  const checkBodies = [];
  page.on('request', async (req) => {
    const url = req.url();
    if (url.includes('/api/check') && req.method() === 'POST') {
      try {
        const post = req.postData();
        checkBodies.push({ url, post, headers: req.headers() });
        console.log('[CHECK REQ]', url);
        console.log('  POST body (前 500):', (post || '').substring(0, 500));
      } catch (e) {}
    }
  });
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (url.includes('/api/check') || url.includes('/api/verify')) {
        const txt = await resp.text();
        console.log('[CHECK RES]', url, txt.substring(0, 500));
      }
    } catch (e) {}
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

  // 等 jcap iframe 加载
  // 设置 debugger breakpoint 当 jcap 加载
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

  // 找 jcap iframe，设置 debugger
  const iframes = page.frames();
  console.log(`找到 ${iframes.length} frames`);

  // 在 jcap iframe 里设置 debugger
  let captchaFrame = null;
  for (const f of iframes) {
    try {
      const url = f.url();
      if (url.includes('jcap') || url.includes('captcha')) {
        captchaFrame = f;
        console.log('找到 captcha frame:', url);
        break;
      }
    } catch (e) {}
  }

  if (captchaFrame) {
    // 在 captcha frame 中设置断点
    // 但 k 函数在 closure 中无法访问
    // 改为 hook k function via debugger breakpoint on text

    // 用 setBreakpointOnText - 找 jcap SDK 内的 "k([" 模式
    try {
      // 在所有 source 中搜
      const frameClient = await captchaFrame.target().createCDPSession();
      await frameClient.send('Debugger.enable');
      // 设置断点
      const scripts = await frameClient.send('Debugger.getScriptSource', {}).catch(() => null);
    } catch (e) {
      console.log('frame debugger error:', e.message);
    }
  }

  // 用 evaluate 注入：监控 jcap iframe 内部提交
  await page.evaluate(() => {
    // 找所有 iframe，hook 它们的提交
    const iframes = document.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
      try {
        const w = iframes[i].contentWindow;
        if (w) {
          // hook fetch 和 XHR
          if (!w.__hooked) {
            w.__hooked = true;
            const origFetch = w.fetch;
            w.fetch = function(...args) {
              const url = typeof args[0] === 'string' ? args[0] : args[0].url;
              if (url && url.includes('/api/check')) {
                console.log('[iframe FETCH check]', args[1] && args[1].body);
              }
              return origFetch.apply(this, args);
            };
            const origOpen = w.XMLHttpRequest.prototype.open;
            const origSend = w.XMLHttpRequest.prototype.send;
            w.XMLHttpRequest.prototype.open = function(method, url) {
              this._url = url;
              return origOpen.apply(this, arguments);
            };
            w.XMLHttpRequest.prototype.send = function(body) {
              if (this._url && this._url.includes('/api/check')) {
                console.log('[iframe XHR check]', body && body.substring(0, 1000));
              }
              return origSend.apply(this, arguments);
            };
          }
        }
      } catch (e) {
        console.log('iframe ' + i + ' access denied:', e.message);
      }
    }
  });
  console.log('iframe hook 注入完成');

  // 画一个对角线触发 submit
  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  if (imgInfo) {
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
  }
  await sleep(10000);

  // 抓 check body
  console.log('\n=== checkBodies ===');
  for (const b of checkBodies) {
    console.log(b.url);
    console.log(b.post && b.post.substring(0, 500));
    console.log('---');
  }

  await browser.close();
})();
