#!/usr/bin/env node
/**
 * 117_jcap_full_req_body.js
 *
 * 抓 jcap 完整 POST body（不截断）
 * 看提交了什么字段
 */

const puppeteer = require('puppeteer-core');
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

  // 用 CDP Network domain 抓 request body
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');

  const reqBodies = new Map(); // requestId -> body
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('jcap') || e.request.url.includes('/api/')) {
      reqBodies.set(e.requestId, e.request.postData || '');
    }
  });
  cdp.on('Network.responseReceived', async (e) => {
    if (e.response.url.includes('jcap') || e.response.url.includes('/api/')) {
      console.log(`\n[${e.type}] ${e.response.status} ${e.response.url.split('/').slice(-3).join('/')}`);
      const body = reqBodies.get(e.requestId) || '';
      if (body) {
        // 解析 form body
        const params = new URLSearchParams(body);
        const short = {};
        for (const [k, v] of params) {
          if (v.length > 60) short[k] = v.substring(0, 60) + `...(${v.length} chars)`;
          else short[k] = v;
        }
        console.log(`  REQ: ${JSON.stringify(short)}`);
      } else {
        console.log(`  REQ: (empty)`);
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
          for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp', 'si', 'ncode', 'errcode']) {
            if (k in j) short[k] = j[k] === '' ? '""' : (typeof j[k] === 'string' ? j[k].substring(0, 80) + (j[k].length > 80 ? '...' : '') : j[k]);
          }
          console.log(`  RESP: ${JSON.stringify(short)}`);
          if (j.img) console.log(`  RESP img: ${j.img.length} chars`);
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

  // 真实斜线拖动
  const startX = imgInfo.x + 30;
  const startY = imgInfo.y + imgInfo.dh - 30;
  const endX = imgInfo.x + imgInfo.dw - 30;
  const endY = imgInfo.y + 30;

  await page.mouse.move(startX, startY, { steps: 20 });
  await sleep(300);
  await page.mouse.down();
  await sleep(100);
  const N = 60;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = startX + ease * (endX - startX);
    const y = startY + ease * (endY - startY);
    await page.mouse.move(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2);
    await sleep(15 + Math.random() * 10);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(10000);

  await browser.close();
})();
