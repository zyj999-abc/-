#!/usr/bin/env node
/**
 * 118_jcap_slow_realistic.js
 *
 * 用更慢、更真实的轨迹（100 步 + 7 秒 + 多层次 jitter）
 * 看 jcap 16807 是否能过
 */

const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: false,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--window-size=1366,768',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    // 阻止 webdriver 暴露
    if (navigator.__proto__._defineGetter__) {
      delete navigator.__proto__._defineGetter__;
    }
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');

  const reqBodies = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('jcap') || e.request.url.includes('/api/')) {
      reqBodies.set(e.requestId, e.request.postData || '');
    }
  });
  cdp.on('Network.responseReceived', async (e) => {
    if (e.response.url.includes('cgi-bin/api/')) {
      console.log(`\n${e.response.url.split('/').slice(-2).join('/')}`);
      const body = reqBodies.get(e.requestId) || '';
      if (body) {
        const params = new URLSearchParams(body);
        const short = {};
        for (const [k, v] of params) {
          if (v.length > 50) short[k] = v.substring(0, 50) + `...(${v.length})`;
          else short[k] = v;
        }
        console.log(`  REQ: ${JSON.stringify(short)}`);
      }
    }
  });
  cdp.on('Network.loadingFinished', async (e) => {
    if (reqBodies.has(e.requestId)) {
      try {
        const resp = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
        const body = resp.body || '';
        try {
          const j = JSON.parse(body);
          const short = {};
          for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp', 'si']) {
            if (k in j) short[k] = j[k] === '' ? '""' : (typeof j[k] === 'string' ? j[k].substring(0, 80) + (j[k].length > 80 ? '...' : '') : j[k]);
          }
          console.log(`  RESP: ${JSON.stringify(short)}`);
        } catch (e) {
          console.log(`  RESP: ${body.substring(0, 200)}`);
        }
      } catch (e) {}
      reqBodies.delete(e.requestId);
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  const ts = Date.now().toString().slice(-8);
  async function humanInput(sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await sleep(150);
    await page.mouse.click(x, y, { clickCount: 3 });
    await sleep(150);
    for (const ch of text) await page.keyboard.type(ch, { delay: 100 + Math.random() * 100 });
  }
  async function humanClick(sel) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 10 + Math.random() * (box.width - 20);
    const y = box.y + 5 + Math.random() * (box.height - 10);
    await page.mouse.move(x, y, { steps: 8 });
    await sleep(200);
    await page.mouse.click(x, y);
  }

  await humanInput('#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(800);
  await humanInput('#nloginpwd', 'Pwd!@#abc1234');
  await sleep(1000);

  let triggered = false;
  for (let i = 1; i <= 5; i++) {
    await humanClick('.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2000);
      try {
        const r = await page.$('#cpc_img, #curve_main_img, #main_img');
        if (r) { console.log('触发 click=' + i); triggered = true; break; }
      } catch (e) {}
    }
    if (triggered) break;
    await sleep(3000);
  }
  if (!triggered) { console.log('未触发'); await browser.close(); return; }
  await sleep(3000);

  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  if (!imgInfo) { console.log('no cpc_img'); await browser.close(); return; }
  console.log('cpc_img:', JSON.stringify(imgInfo));

  // 真实斜线（左下到右上）
  const startX = imgInfo.x + 30;
  const startY = imgInfo.y + imgInfo.dh - 30;
  const endX = imgInfo.x + imgInfo.dw - 30;
  const endY = imgInfo.y + 30;

  // 慢速、真实步长
  await page.mouse.move(startX, startY, { steps: 30 });
  await sleep(500);
  await page.mouse.down();
  await sleep(200);
  const N = 100;
  const startTime = Date.now();
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    // 缓动：开始慢、中间快、结束慢
    const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = startX + ease * (endX - startX);
    const y = startY + ease * (endY - startY);
    // 大 jitter (5 像素)
    const jitterX = (Math.random() - 0.5) * 4;
    const jitterY = (Math.random() - 0.5) * 4;
    await page.mouse.move(x + jitterX, y + jitterY);
    // 时间步 30-80ms
    let dt;
    if (i < 15) dt = 50 + Math.random() * 30;
    else if (i < N - 15) dt = 30 + Math.random() * 20;
    else dt = 60 + Math.random() * 30;
    await sleep(dt);
  }
  const elapsed = Date.now() - startTime;
  console.log(`拖动完成，用时 ${elapsed}ms`);
  await sleep(500);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(10000);

  await browser.close();
})();
