#!/usr/bin/env node
/**
 * 120_jcap_emit_touch.js
 *
 * 尝试用真实 touch 事件（touchstart/touchmove/touchend）而非 mouse 事件
 * 看 jcap 服务端是否对 touch 事件更"友好"
 */

const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768, hasTouch: true, isMobile: false },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  const respLog = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('/cgi-bin/api/')) respLog.push({ requestId: e.requestId, url: e.request.url, postData: e.request.postData || '' });
  });
  cdp.on('Network.loadingFinished', async (e) => {
    const r = respLog.find(r => r.requestId === e.requestId);
    if (!r) return;
    try {
      const resp = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
      r.body = resp.body || '';
    } catch (e) {}
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  const ts = Date.now().toString().slice(-8);
  async function humanInput(sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    await page.mouse.click(box.x + 30, box.y + box.height / 2, { clickCount: 3 });
    await sleep(150);
    for (const ch of text) await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
  }
  async function humanClick(sel) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    await page.mouse.click(box.x + 10 + Math.random() * (box.width - 20), box.y + 5 + Math.random() * (box.height - 10));
  }

  await humanInput('#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(500);
  await humanInput('#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    await sleep(8000);
    try {
      const r = await page.$('#cpc_img, #curve_main_img, #main_img');
      if (r) { console.log('触发 click=' + i); break; }
    } catch (e) {}
  }
  await sleep(3000);

  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  if (!imgInfo) { console.log('no cpc_img'); await browser.close(); return; }
  console.log('cpc_img:', JSON.stringify(imgInfo));

  // 用 CDP Input.dispatchTouchEvent 发送真实 touch 事件
  const startX = imgInfo.x + 30;
  const startY = imgInfo.y + imgInfo.dh - 30;
  const endX = imgInfo.x + imgInfo.dw - 30;
  const endY = imgInfo.y + 30;

  // touchStart
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  await sleep(200);

  // 100 步 touchMove
  const N = 100;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = startX + ease * (endX - startX);
    const y = startY + ease * (endY - startY);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (Math.random() - 0.5) * 3, y: y + (Math.random() - 0.5) * 3, id: 1 }],
    });
    await sleep(40 + Math.random() * 30);
  }

  // touchEnd
  await sleep(300);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  console.log('touchEnd done');
  await sleep(10000);

  // 输出 /api/ 响应
  for (const r of respLog) {
    try {
      const params = new URLSearchParams(r.postData);
      const short = {};
      for (const [k, v] of params) short[k] = v.length > 50 ? v.substring(0, 50) + `...(${v.length})` : v;
      const j = JSON.parse(r.body);
      const respShort = {};
      for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp']) {
        if (k in j) respShort[k] = j[k] === '' ? '""' : (typeof j[k] === 'string' ? j[k].substring(0, 60) : j[k]);
      }
      console.log(`${r.url.split('/').slice(-2).join('/')}: REQ=${JSON.stringify(short)} RESP=${JSON.stringify(respShort)}`);
    } catch (e) {
      console.log(`${r.url}: ${r.postData.substring(0, 200)} -> ${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
