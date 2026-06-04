#!/usr/bin/env node
/**
 * 115_jcap_check_fp_auto.js
 *
 * 加载页面后，5 秒内不操作，看 jcap 是否自动调 /api/fp
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
    if (url.includes('/api/') || url.includes('jcap')) {
      try {
        const txt = await resp.text();
        respLog.push({ time: Date.now(), url, body: txt.substring(0, 300) });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  console.log('页面加载完，等 5 秒看 jcap 是否自动调 /api/fp...');
  await sleep(5000);

  console.log('\n=== 5 秒内的 jcap/api 调用 ===');
  for (const r of respLog) {
    console.log(`[${new Date(r.time).toISOString().slice(11, 19)}] ${r.url.split('/').slice(-3).join('/')}`);
    console.log(`   ${r.body.substring(0, 200)}`);
  }
  console.log(`Total: ${respLog.length} requests`);

  await browser.close();
})();
