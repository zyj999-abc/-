#!/usr/bin/env node
/**
 * 80_jcap_iframe_check.js
 *
 * 检查 captcha 是否在 iframe 中，并尝试访问内部组件。
 */
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  console.log('[1] 打开登录页');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  console.log('[2] 输入账号密码');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', `jd_test_${Date.now()}@163.com`, { delay: 80 });
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  console.log('[3] 点击登录触发验证码');
  for (let click = 1; click <= 3; click++) {
    await page.click('.login-btn');
    await sleep(5000);
    const has = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
    if (has) {
      console.log(`  ${click} 次后触发`);
      break;
    }
  }
  await sleep(5000);

  // 检查 iframe
  const info = await page.evaluate(() => {
    const out = {
      cpcImg: null,
      iframes: [],
      allFrames: [],
    };
    const cpc = document.querySelector('#cpc_img');
    if (cpc) {
      const r = cpc.getBoundingClientRect();
      out.cpcImg = { x: r.x, y: r.y, w: cpc.offsetWidth, h: cpc.offsetHeight, parent: cpc.parentElement?.tagName, ownerDoc: cpc.ownerDocument === document ? 'same' : 'different' };
    }
    document.querySelectorAll('iframe').forEach((f, i) => {
      out.iframes.push({ idx: i, src: f.src, name: f.name, id: f.id });
    });
    return out;
  });

  console.log('[4] 页面信息:');
  console.log('  cpcImg:', JSON.stringify(info.cpcImg));
  console.log('  iframes:', info.iframes.length);
  for (const f of info.iframes) {
    console.log('    -', JSON.stringify(f));
  }

  // 看所有 frame
  const frames = page.frames();
  console.log('  frames:', frames.length);
  for (const f of frames) {
    console.log('    -', f.url());
  }

  // 在每个 frame 里查 cpc_img
  for (const f of frames) {
    try {
      const has = await f.evaluate(() => !!document.querySelector('#cpc_img'));
      if (has) {
        console.log('  ✅ cpc_img 在 frame:', f.url());
      }
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/80_frames.png', fullPage: true });
  await browser.close();
})();
