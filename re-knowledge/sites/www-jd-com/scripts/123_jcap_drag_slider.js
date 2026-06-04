#!/usr/bin/env node
/**
 * 123_jcap_drag_slider.js
 *
 * 正确操作：拖动 #slide_path 让 cpc_img 旋转到正
 * 实际是"旋转图片"验证码，jcap SDK 自动检测角度
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

  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  const respLog = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('/cgi-bin/api/')) {
      respLog.push({ requestId: e.requestId, url: e.request.url, postData: e.request.postData || '' });
    }
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

  // 抓 slide_path 位置和 cpc_img rotation
  await sleep(2000);
  const allElements = await page.evaluate(() => {
    const modal = document.querySelector('#captcha_modal, .captcha_modal_pc');
    if (!modal) return { err: 'no modal' };
    const ids = [];
    modal.querySelectorAll('[id]').forEach(el => ids.push({ id: el.id, cls: el.className, tag: el.tagName, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, w: el.offsetWidth, h: el.offsetHeight }));
    return { ids, modal: { x: modal.getBoundingClientRect().x, y: modal.getBoundingClientRect().y, w: modal.offsetWidth, h: modal.offsetHeight } };
  });
  console.log('Modal elements:', JSON.stringify(allElements, null, 2).substring(0, 3000));

  // 找拖动元素
  const slidePath = await page.evaluate(() => {
    const candidates = ['#slide_path', '.drag-box', '#local_footer', '.captcha_footer', '#cpc_img'];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        return { sel, x: r.x, y: r.y, w: r.width, h: r.height, transform: getComputedStyle(el).transform };
      }
    }
    return null;
  });
  console.log('Slide path:', JSON.stringify(slidePath));
  if (!slidePath) { console.log('no drag element found'); await browser.close(); return; }

  // 拖动 slide_path（水平方向）
  const startX = slidePath.x + slidePath.w / 2;
  const startY = slidePath.y + slidePath.h / 2;
  // 拖动到右端（170 像素 - 让图片转回 0 度）
  const endX = startX + 170;
  const endY = startY;

  console.log('Dragging from', startX, startY, 'to', endX, endY);
  await page.mouse.move(startX, startY, { steps: 20 });
  await sleep(300);
  await page.mouse.down();
  await sleep(100);
  const N = 80;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const x = startX + ease * (endX - startX);
    const y = startY + ease * (endY - startY);
    await page.mouse.move(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2);
    await sleep(20 + Math.random() * 10);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(10000);

  // 输出 /api/ 响应
  for (const r of respLog) {
    const ep = r.url.split('/').slice(-2).join('/');
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}
    if (j) {
      const short = {};
      for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp']) {
        if (k in j) short[k] = j[k] === '' ? '""' : (typeof j[k] === 'string' ? j[k].substring(0, 60) : j[k]);
      }
      console.log(`${ep}: ${JSON.stringify(short)}`);
    } else {
      console.log(`${ep}: ${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
