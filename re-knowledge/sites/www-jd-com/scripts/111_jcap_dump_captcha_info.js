#!/usr/bin/env node
/**
 * 111_jcap_dump_captcha_info.js
 *
 * 触发 jcap 后，抓 cpc_img 详细属性（src, position, size, 也抓 drag button）
 * 看 jcap 是哪种类型
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

  // 抓 captcha 详细信息
  const info = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc) return { error: 'no cpc_img' };
    const r = cpc.getBoundingClientRect();

    // 找所有 captcha 相关元素
    const all = [];
    document.querySelectorAll('[id*="cpc"], [class*="cpc"], [id*="captcha"], [class*="captcha"]').forEach(el => {
      const rr = el.getBoundingClientRect();
      all.push({ id: el.id, cls: el.className, tag: el.tagName, x: rr.x, y: rr.y, w: rr.width, h: rr.height });
    });

    // 找 drag button
    const dragBtn = document.querySelector('.cpc_dropbtn, [class*="dragbtn"], #cpc_drop, .cpc_drop, [class*="dropbtn"]');

    // 找 canvas
    const canvas = document.querySelector('canvas');

    return {
      cpc: { x: r.x, y: r.y, w: r.width, h: r.height, srcLen: cpc.src.length, srcStart: cpc.src.substring(0, 80), naturalW: cpc.naturalWidth, naturalH: cpc.naturalHeight },
      dragBtn: dragBtn ? { cls: dragBtn.className, id: dragBtn.id, x: dragBtn.getBoundingClientRect().x, y: dragBtn.getBoundingClientRect().y, w: dragBtn.getBoundingClientRect().width, h: dragBtn.getBoundingClientRect().height } : null,
      canvas: canvas ? { x: canvas.getBoundingClientRect().x, y: canvas.getBoundingClientRect().y, w: canvas.width, h: canvas.height } : null,
      all: all,
      // 整个 captcha 容器
      captchaContainer: (() => {
        const c = document.querySelector('.cpc_container, .captcha_container, [id*="captcha_box"], .cpc-box');
        if (!c) return null;
        const rr = c.getBoundingClientRect();
        return { cls: c.className, id: c.id, x: rr.x, y: rr.y, w: rr.width, h: rr.height };
      })(),
    };
  });
  console.log('\n=== Captcha info ===');
  console.log(JSON.stringify(info, null, 2));

  // 保存 cpc_img 完整 base64
  if (info.cpc && info.cpc.src) {
    const b64 = info.cpc.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/captcha_v2.jpg', Buffer.from(b64, 'base64'));
    console.log('Saved /tmp/captcha_v2.jpg');
  }

  await page.screenshot({ path: '/tmp/captcha_full.png', fullPage: true });
  console.log('Saved /tmp/captcha_full.png');

  await browser.close();
})();
