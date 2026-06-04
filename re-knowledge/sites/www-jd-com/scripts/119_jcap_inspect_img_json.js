#!/usr/bin/env node
/**
 * 119_jcap_inspect_img_json.js
 *
 * 抓 /api/check 第一次响应的 img 字段完整 JSON
 * 看是否有 "目标位置" 提示
 */

const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fs = require('fs');

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

  const allResponses = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('jcap') || e.request.url.includes('/api/')) {
      allResponses.push({ requestId: e.requestId, url: e.request.url, postData: e.request.postData || '' });
    }
  });
  cdp.on('Network.loadingFinished', async (e) => {
    const r = allResponses.find(r => r.requestId === e.requestId);
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

  // 等所有 jcap 响应完成
  await sleep(5000);

  // 找 /api/check 第一次响应
  for (const r of allResponses) {
    if (r.url.includes('/api/check') && r.body) {
      try {
        const j = JSON.parse(r.body);
        if (j.img && !r._printed) {
          r._printed = true;
          // 解析 img JSON
          const imgJson = JSON.parse(j.img);
          console.log('img JSON keys:', Object.keys(imgJson));
          for (const k of Object.keys(imgJson)) {
            const v = imgJson[k];
            if (typeof v === 'string' && v.length > 100) {
              console.log(`  ${k}: ${v.substring(0, 100)}... (${v.length} chars)`);
              // 保存 b1 图
              if (k === 'b1' && v.startsWith('data:image')) {
                const b64 = v.replace(/^data:image\/\w+;base64,/, '');
                fs.writeFileSync('/tmp/jcap_b1.jpg', Buffer.from(b64, 'base64'));
                console.log(`  -> saved /tmp/jcap_b1.jpg (${b64.length} b64 chars)`);
              }
            } else {
              console.log(`  ${k}: ${v}`);
            }
          }
        }
      } catch (e) {}
    }
  }

  // 保存 cpc_img
  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, w: cpc.offsetWidth, h: cpc.offsetHeight, src: cpc.src };
  });
  if (imgInfo && imgInfo.src.startsWith('data:')) {
    const b64 = imgInfo.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jcap_cpc_img.jpg', Buffer.from(b64, 'base64'));
    console.log(`\ncpc_img saved: ${imgInfo.x},${imgInfo.y} ${imgInfo.w}x${imgInfo.h}`);
  }

  await browser.close();
})();
