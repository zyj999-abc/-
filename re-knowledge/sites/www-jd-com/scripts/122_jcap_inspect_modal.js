#!/usr/bin/env node
/**
 * 122_jcap_inspect_modal.js
 *
 * 抓 jcap 弹窗内所有图片和子元素
 * 看是不是"拼图拖动"而不是"画线"
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

  // 抓 jcap modal 完整 DOM
  const info = await page.evaluate(() => {
    const modal = document.querySelector('#captcha_modal, .captcha_modal_pc');
    if (!modal) return { err: 'no modal' };
    const result = {
      modal: {
        id: modal.id,
        cls: modal.className,
        x: modal.getBoundingClientRect().x,
        y: modal.getBoundingClientRect().y,
        w: modal.offsetWidth,
        h: modal.offsetHeight,
      },
      images: [],
      divs: [],
    };
    modal.querySelectorAll('img').forEach((img) => {
      const r = img.getBoundingClientRect();
      result.images.push({
        id: img.id, cls: img.className,
        x: r.x, y: r.y, w: r.width, h: r.height,
        naturalW: img.naturalWidth, naturalH: img.naturalHeight,
        srcStart: img.src.substring(0, 60),
        srcLen: img.src.length,
      });
    });
    modal.querySelectorAll('div, canvas').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 5 && r.height > 5) {
        result.divs.push({
          tag: el.tagName, id: el.id, cls: el.className,
          x: r.x, y: r.y, w: r.width, h: r.height,
          text: (el.textContent || '').substring(0, 50),
        });
      }
    });
    return result;
  });
  console.log(JSON.stringify(info, null, 2));

  // 保存所有图片
  if (info.images) {
    for (let i = 0; i < info.images.length; i++) {
      const img = info.images[i];
      const data = await page.evaluate((idx) => {
        const modal = document.querySelector('#captcha_modal, .captcha_modal_pc');
        const imgs = modal.querySelectorAll('img');
        return imgs[idx].src;
      }, i);
      if (data && data.startsWith('data:')) {
        const b64 = data.replace(/^data:image\/\w+;base64,/, '');
        const ext = data.substring(11, data.indexOf(';'));
        fs.writeFileSync(`/tmp/jcap_modal_${i}.${ext}`, Buffer.from(b64, 'base64'));
        console.log(`\nSaved /tmp/jcap_modal_${i}.${ext} (${b64.length} b64 chars)`);
      }
    }
  }

  await browser.close();
})();
