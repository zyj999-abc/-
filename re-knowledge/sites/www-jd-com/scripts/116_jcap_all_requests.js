#!/usr/bin/env node
/**
 * 116_jcap_all_requests.js
 *
 * 触发 jcap + 拖动后抓所有 jcap/api 调用
 * 确认 16807 失败的真正原因
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

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('jcap') || url.includes('/api/')) {
      try {
        const txt = await resp.text();
        const req = resp.request();
        let reqBody = '';
        try { reqBody = req.postData() || ''; } catch (e) {}
        respLog.push({ time: Date.now(), url, method: req.method(), reqBody, body: txt.substring(0, 1500) });
      } catch (e) {}
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

  // 真实拖动
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

  console.log('\n=== 所有 jcap/api 请求时序 ===');
  for (const r of respLog) {
    const ep = r.url.split('/').slice(-3).join('/');
    const bodyParsed = (() => { try { return JSON.parse(r.body); } catch (e) { return null; } })();
    const reqParsed = (() => { try { return JSON.parse(r.reqBody); } catch (e) { return null; } })();
    console.log(`\n[${new Date(r.time).toISOString().slice(11, 19)}] ${r.method} ${ep}`);
    if (reqParsed) {
      console.log(`  REQ keys: ${Object.keys(reqParsed).join(', ')}`);
    } else {
      console.log(`  REQ: ${r.reqBody.substring(0, 200)}`);
    }
    if (bodyParsed) {
      const short = {};
      for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp', 'si', 'ncode', 'errcode']) {
        if (k in bodyParsed) short[k] = bodyParsed[k] === '' ? '""' : (typeof bodyParsed[k] === 'string' ? bodyParsed[k].substring(0, 60) + (bodyParsed[k].length > 60 ? '...' : '') : bodyParsed[k]);
      }
      console.log(`  RESP: ${JSON.stringify(short)}`);
      if (bodyParsed.img) console.log(`  RESP img: ${bodyParsed.img.substring(0, 80)}... (${bodyParsed.img.length} chars)`);
    } else {
      console.log(`  RESP: ${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
