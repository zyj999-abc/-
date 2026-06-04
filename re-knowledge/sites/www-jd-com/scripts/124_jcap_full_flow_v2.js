#!/usr/bin/env node
/**
 * 124_jcap_full_flow_v2.js
 *
 * 最终尝试：用 jdSlide d 参数算法 + jcap SDK F 函数 + 智能轨迹
 * 看 jcap 16807 能否过
 *
 * 关键策略：
 * 1. 触发 jcap
 * 2. 抓 cpc_img
 * 3. 用 OpenCV + scikit-image 检测图中"目标轨迹"（沿暗色 Z 形/弧线）
 * 4. 用 200 步慢速绘制（带随机 jitter）
 * 5. jcap SDK 自动算 tk/ct/cs 并提交
 * 6. 拿 vt
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const VENV_SITE = '/workspace/re-knowledge/sites/www-jd-com';
const GEN_SCRIPT = path.join(VENV_SITE, 'scripts/88_gen_z_path.py');

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

  // 抓 cpc_img
  const cpcBase64 = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return null;
    return cpc.src;
  });
  if (!cpcBase64) { console.log('no cpc_img'); await browser.close(); return; }
  fs.writeFileSync('/tmp/jcap_v2.jpg', Buffer.from(cpcBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  console.log('Saved /tmp/jcap_v2.jpg');

  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    const r = cpc.getBoundingClientRect();
    return { x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  console.log('cpc_img:', JSON.stringify(imgInfo));

  // 调 88 检测路径
  const points = JSON.parse(execSync(`python3 ${GEN_SCRIPT} /tmp/jcap_v2.jpg 200`, { encoding: 'utf-8' }));
  console.log('生成的轨迹点数:', points.points.length);
  console.log('前 3 点:', points.points.slice(0, 3));
  console.log('最后 3 点:', points.points.slice(-3));

  // 沿路径绘制
  const startX = imgInfo.x + points.points[0].x;
  const startY = imgInfo.y + points.points[0].y;
  await page.mouse.move(startX, startY, { steps: 20 });
  await sleep(300);
  await page.mouse.down();
  await sleep(100);
  // 慢速沿路径绘制
  for (let i = 1; i < points.points.length; i++) {
    const p = points.points[i];
    const x = imgInfo.x + p.x;
    const y = imgInfo.y + p.y;
    await page.mouse.move(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2);
    await sleep(15 + Math.random() * 10);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(10000);

  console.log('\n=== /api/ 响应 ===');
  for (const r of respLog) {
    const ep = r.url.split('/').slice(-2).join('/');
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}
    if (j) {
      const short = {};
      for (const k of ['code', 'msg', 'tp', 'st', 'vt', 'fp']) {
        if (k in j) short[k] = j[k] === '' ? '""' : (typeof j[k] === 'string' ? j[k].substring(0, 80) : j[k]);
      }
      console.log(`${ep}: ${JSON.stringify(short)}`);
    } else {
      console.log(`${ep}: ${r.body.substring(0, 200)}`);
    }
  }

  await browser.close();
})();
