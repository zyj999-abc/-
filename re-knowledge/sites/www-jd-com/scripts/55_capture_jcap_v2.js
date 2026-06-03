#!/usr/bin/env node
/**
 * 抓 jcap 验证码图 v2 (保存真实图片)
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
  await page.type('#loginname', 'jd_test_456@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(10000);

  console.log('jcap 响应:');
  let saved = 0;
  for (let idx = 0; idx < respLog.length; idx++) {
    const r = respLog[idx];
    console.log(`\n  [POST] ${r.url.slice(0, 80)}`);
    // 打印前 300 字符
    console.log(`  body: ${r.body.slice(0, 400)}`);

    // 提取 img 字段 (b1 等)
    const m = r.body.match(/"img":"(.*?)"}/);
    if (m) {
      try {
        const imgStr = m[1].replace(/\\"/g, '"');
        const imgObj = JSON.parse(imgStr);
        for (const [k, v] of Object.entries(imgObj)) {
          if (typeof v === 'string' && v.startsWith('data:image/')) {
            const b64 = v.replace(/^data:image\/\w+;base64,/, '');
            fs.writeFileSync(`/tmp/jd_track/jcap_img_${idx}_${k}.png`, Buffer.from(b64, 'base64'));
            console.log(`    → ${k} saved (${(b64.length * 3/4 / 1024).toFixed(1)} KB)`);
            saved++;
          }
        }
      } catch (e) {
        console.log(`    parse err: ${e.message}`);
      }
    }
  }
  console.log(`\n共保存 ${saved} 张图`);

  // 看 jcap UI tip 和元素
  const ui = await page.evaluate(() => {
    const tip = document.querySelector('.tip_text, .tip_text_container');
    const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
      src: i.src.slice(0, 100),
      w: i.offsetWidth,
      h: i.offsetHeight,
      id: i.id,
      cls: i.className,
    })).filter(i => i.src.startsWith('data:') || i.w > 50);
    return {
      tipText: tip ? tip.innerText : null,
      imgs,
    };
  });
  console.log('\nUI:');
  console.log('  tipText:', JSON.stringify(ui.tipText));
  for (const i of ui.imgs.slice(0, 5)) {
    console.log('  img:', JSON.stringify(i));
  }

  await browser.close();
})();
