#!/usr/bin/env node
/**
 * 114_jcap_inspect_fp.js
 *
 * 看 /api/fp 接口响应（指纹接口）
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
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
    if (url.includes('/api/')) {
      try {
        const txt = await resp.text();
        const req = resp.request();
        let reqBody = '';
        try { reqBody = req.postData() || ''; } catch (e) {}
        respLog.push({ url, method: req.method(), body: txt.substring(0, 3000), reqBody: reqBody.substring(0, 2000) });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

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

  await humanClick('.login-btn');
  await sleep(8000);

  console.log('\n=== 所有 /api/ 响应 ===');
  for (const r of respLog) {
    const ep = r.url.split('/').slice(-3).join('/');
    console.log(`\n[${r.method}] ${ep}`);
    if (r.reqBody) console.log('  REQ:', r.reqBody.substring(0, 500));
    console.log('  RESP:', r.body.substring(0, 1500));
  }

  await browser.close();
})();
