#!/usr/bin/env node
/**
 * 92_jcap_dump_sdk.js
 *
 * 抓 jcap SDK 完整 JS 到本地，便于静态分析 k() 加密函数。
 * 1. 打开 passport.jd.com
 * 2. 触发 jcap
 * 3. 从 network 抓 jcap_ujb96b.js（jcap SDK）
 * 4. 同时抓 .wasm 文件
 * 5. 抓 jcap.create 后挂的 window 全局对象
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const OUT_DIR = '/tmp/jcap_dump';
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const scriptCaptures = [];
  const wasmCaptures = [];

  // 拦截所有 script 响应
  const cdp = await page.target().createCDPSession();
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Response' }],
  });
  await cdp.on('Fetch.requestPaused', async (event) => {
    const url = event.request.url;
    try {
      if (url.includes('jcap_') && url.endsWith('.js')) {
        const body = event.responseStatusCode === 200 ? await fetch(event.request.url).then(r => r.text()).catch(() => null) : null;
        // 用 Network 拉取 body
        const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
        if (resp && resp.body) {
          const fname = url.split('/').pop();
          const out = path.join(OUT_DIR, fname);
          let content = resp.body;
          if (event.responseStatusCode === 200 && resp.base64Encoded) {
            content = Buffer.from(resp.body, 'base64');
          }
          fs.writeFileSync(out, content);
          scriptCaptures.push({ url, file: out, size: content.length });
          console.log(`[SCRIPT] ${url} -> ${out} (${content.length} bytes)`);
        }
        await cdp.send('Fetch.continueResponse', { requestId: event.requestId });
      } else if (url.endsWith('.wasm')) {
        const resp = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
        if (resp && resp.body) {
          const fname = url.split('/').pop();
          const out = path.join(OUT_DIR, fname);
          let content = resp.base64Encoded ? Buffer.from(resp.body, 'base64') : resp.body;
          fs.writeFileSync(out, content);
          wasmCaptures.push({ url, file: out, size: content.length });
          console.log(`[WASM] ${url} -> ${out} (${content.length} bytes)`);
        }
        await cdp.send('Fetch.continueResponse', { requestId: event.requestId });
      } else {
        await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
      }
    } catch (e) {
      console.log('Fetch error:', e.message);
      try { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); } catch (_) {}
    }
  });

  // 兜底：也用 page.on('response') 抓
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if ((url.includes('jcap_') && url.endsWith('.js')) || url.includes('.wasm')) {
        const buf = await resp.buffer().catch(() => null);
        if (buf) {
          const fname = url.split('?')[0].split('/').pop();
          const out = path.join(OUT_DIR, fname);
          // 避免重复写
          if (!fs.existsSync(out)) {
            fs.writeFileSync(out, buf);
            console.log(`[FALLBACK] ${url} -> ${out} (${buf.length} bytes)`);
          }
        }
      }
    } catch (e) {}
  });

  console.log('打开 passport.jd.com ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  // 输入触发验证码
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

  console.log('点击登录触发 jcap ...');
  let triggered = false;
  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2500);
      const r = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
      if (r) {
        console.log(`触发 (click ${i}, ${(w+1)*2.5}s)`);
        triggered = true;
        break;
      }
    }
    if (triggered) break;
    await sleep(5000);
  }

  if (triggered) {
    // 等 SDK 完成
    await sleep(3000);
    // 抓 jcap 全局对象
    const globalInfo = await page.evaluate(() => {
      const out = {};
      for (const k of Object.keys(window)) {
        if (k.includes('jcap') || k.includes('Jcap') || k.includes('JCap') || k.includes('JDCap')) {
          try {
            out[k] = typeof window[k];
          } catch (e) {}
        }
      }
      // 抓 jcap iframe 内部的全局
      try {
        const iframe = document.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
          for (const k of Object.keys(iframe.contentWindow)) {
            if (k.toLowerCase().includes('captcha') || k.toLowerCase().includes('jcap')) {
              out['iframe.' + k] = typeof iframe.contentWindow[k];
            }
          }
        }
      } catch (e) {}
      return out;
    });
    console.log('jcap globals:', JSON.stringify(globalInfo, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'globals.json'), JSON.stringify(globalInfo, null, 2));
  }

  console.log('\n=== 抓取结果 ===');
  console.log('Scripts:', scriptCaptures.length);
  console.log('Wasm:', wasmCaptures.length);
  console.log('Files in', OUT_DIR);
  console.log(fs.readdirSync(OUT_DIR).join('\n'));

  await browser.close();
})();
