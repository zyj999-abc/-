#!/usr/bin/env node
/**
 * jcap 完整工作流分析
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

  page.on('console', (msg) => {
    const t = msg.text();
    console.log('  [console]', t.slice(0, 200));
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', 'jd_test_xyz@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(10000);

  // 完整分析 jcap DOM
  const jcapDom = await page.evaluate(() => {
    // 找 jcap 容器
    const dragBox = document.querySelector('.drag-box');
    const allCaps = Array.from(document.querySelectorAll('[class*=cpc], [class*=jcap], [id*=jcap], [id*=cpc]'));
    return {
      dragBoxHTML: dragBox ? dragBox.outerHTML : null,
      allCapsCount: allCaps.length,
      allCapsHtml: allCaps.slice(0, 5).map(c => c.outerHTML.slice(0, 300)),
    };
  });
  console.log('\njcap DOM:');
  console.log('  dragBox:', jcapDom.dragBoxHTML);
  console.log('  allCaps count:', jcapDom.allCapsCount);
  for (const h of jcapDom.allCapsHtml) {
    console.log('  ---\n ', h);
  }

  // 看 jcap 内部 state
  const jcapState = await page.evaluate(() => {
    // 找 jcap vue instance
    const dragBox = document.querySelector('.drag-box');
    if (!dragBox) return 'no dragBox';
    const key = Object.keys(dragBox).find(k => k.startsWith('__vue__'));
    if (!key) return 'no vue key';
    const vue = dragBox[key];
    return {
      data: vue.$options.data ? JSON.stringify(vue.$options.data()).slice(0, 1000) : null,
      computed: vue._computedWatchers ? Object.keys(vue._computedWatchers) : null,
      methods: vue._methods ? Object.keys(vue._methods) : null,
      props: vue._props ? Object.keys(vue._props) : null,
    };
  });
  console.log('\njcap Vue state:', JSON.stringify(jcapState, null, 2));

  await page.screenshot({ path: '/tmp/jd_track/jcap_v3.png', fullPage: true });
  await browser.close();
})();
