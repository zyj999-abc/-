#!/usr/bin/env node
/**
 * 抓 jcap 验证码图 + 显示
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
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
    if (url.includes('jcap') && url.includes('/api/')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', 'jd_test_123@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(8000);

  console.log('jcap 响应:');
  for (const r of respLog) {
    console.log(`\n  [POST] ${r.url.slice(0, 80)}`);
    console.log(`  body: ${r.body.slice(0, 500)}`);

    // 提取 img base64
    const m = r.body.match(/"img":"(data:image\/png;base64,[^"]+)"/);
    if (m) {
      const b64 = m[1].replace(/^data:image\/png;base64,/, '');
      const idx = respLog.indexOf(r);
      fs.writeFileSync(`/tmp/jd_track/jcap_img_${idx}.png`, Buffer.from(b64, 'base64'));
      console.log(`  → saved /tmp/jd_track/jcap_img_${idx}.png (${(b64.length * 3/4 / 1024).toFixed(1)} KB)`);
    }
  }

  // 看 jcap UI 提示文字
  const tipText = await page.evaluate(() => {
    const els = document.querySelectorAll('.tip_text, .tip_text_container, [class*=tip], [class*=order]');
    return Array.from(els).map(e => ({
      cls: e.className,
      text: e.innerText,
    })).filter(t => t.text && t.text.length < 100);
  });
  console.log('\njcap 提示文字:');
  for (const t of tipText) {
    console.log(' ', JSON.stringify(t));
  }

  await page.screenshot({ path: '/tmp/jd_track/jcap_full.png', fullPage: true });

  await browser.close();
})();
