#!/usr/bin/env node
/**
 * 抓取 login2025_append.js 原始内容
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('login2025') || url.includes('login2024') || url.includes('login.index')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(5000);

  fs.writeFileSync('/tmp/jd_track/login_scripts_dump.js', respLog.map(r => `// === ${r.url} ===\n${r.body}\n`).join('\n'));

  console.log('抓取到', respLog.length, '个 login 相关脚本');
  for (const r of respLog) {
    console.log(' -', r.url);
  }

  await browser.close();
})();
