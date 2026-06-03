#!/usr/bin/env node
/**
 * 91_jcap_hook_tk.js
 *
 * Hook jcap k/x/F 加密函数，看 tk 怎么计算的。
 * 1. 触发 jcap
 * 2. 抓 cpc_img
 * 3. 画简单对角线
 * 4. 等 /api/check 响应
 * 5. 输出 tk 详细结构
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TRACK_DIR = '/tmp/jd_track';

async function humanInput(page, sel, text) {
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

async function humanClick(page, sel) {
  const el = await page.$(sel);
  const box = await el.boundingBox();
  const x = box.x + 10 + Math.random() * (box.width - 20);
  const y = box.y + 5 + Math.random() * (box.height - 10);
  await page.mouse.move(x, y, { steps: 5 });
  await sleep(150);
  await page.mouse.click(x, y);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
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

  // hook XHR 拿 submit body
  const captures = [];
  await page.exposeFunction('logFromPage', (data) => {
    captures.push(data);
    console.log('[PAGE]', data);
  });
  await page.evaluateOnNewDocument(() => {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      if (this._url && this._url.includes('/api/check')) {
        window.logFromPage({ type: 'check_body', body: body ? body.substring(0, 2000) : 'null' });
      }
      return origSend.apply(this, arguments);
    };
  });

  page.on('console', m => {
    const t = m.text();
    if (t.includes('[browser]') || t.startsWith('[HOOK]') || t.startsWith('[CAPT]')) {
      console.log(t);
    }
  });

  // 监听所有响应
  const respLog = [];
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (url.includes('/api/check') || url.includes('/api/verify')) {
        const txt = await resp.text();
        respLog.push({ url, body: txt.substring(0, 1500) });
      }
    } catch (e) {}
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  const ts = Date.now().toString().slice(-8);
  await humanInput(page, '#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(500);
  await humanInput(page, '#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  let triggered = false;
  for (let i = 1; i <= 4; i++) {
    await humanClick(page, '.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2000);
      const r = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
      if (r) {
        console.log('triggered click=' + i);
        triggered = true;
        break;
      }
    }
    if (triggered) break;
    await sleep(5000);
  }
  if (!triggered) {
    console.log('not triggered');
    await browser.close();
    return;
  }
  await sleep(2000);

  // 抓 cpc_img
  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc || !cpc.src) return null;
    const r = cpc.getBoundingClientRect();
    return { src: cpc.src, w: cpc.naturalWidth, h: cpc.naturalHeight, x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  if (!imgInfo) {
    console.log('no img');
    await browser.close();
    return;
  }
  console.log(`cpc_img: ${imgInfo.w}x${imgInfo.h} at (${imgInfo.x.toFixed(0)},${imgInfo.y.toFixed(0)})`);

  // 画简单对角线
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
  await sleep(8000);

  console.log('=== captures ===');
  for (const c of captures) {
    console.log(JSON.stringify(c).substring(0, 1500));
  }

  console.log('=== responses ===');
  for (const r of respLog) {
    console.log(r.url);
    console.log(r.body);
    console.log('---');
  }

  // 同时保存 captcha 图
  if (imgInfo.src.startsWith('data:')) {
    const b64 = imgInfo.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(TRACK_DIR, '91_captcha.jpg'), Buffer.from(b64, 'base64'));
    console.log('saved captcha');
  }

  await browser.close();
})();
