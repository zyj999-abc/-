#!/usr/bin/env node
/**
 * jcap API 探测
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

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('jcap') || t.includes('jdCAP') || t.includes('vt') || t.includes('validate')) {
      console.log('  [console]', t.slice(0, 200));
    }
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('jcap')) {
      try {
        const txt = await resp.text();
        if (url.includes('/api/')) {
          console.log(`  [POST ${resp.status()}] ${url.slice(0, 100)}`);
          console.log(`    body: ${txt.slice(0, 200)}`);
        }
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', 'test_acc_123abc@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  await page.click('.login-btn');
  await sleep(8000);

  // 看 jdCAP 实例
  const jcapState = await page.evaluate(() => {
    if (!window.jdCAP) return null;
    const c = window.jdCAP;
    return {
      type: typeof c,
      methods: Object.keys(c).slice(0, 30),
      hasInstance: !!c.jcapInstance,
      jcapInstanceType: typeof c.jcapInstance,
      jcapInstanceMethods: c.jcapInstance ? Object.keys(c.jcapInstance).slice(0, 30) : null,
      jdCAP_constructor: c.constructor ? c.constructor.name : null,
      // 看 jcap 容器
      jcapContainer: document.querySelector('#jcap-main, [class*=jcap]') ? {
        cls: document.querySelector('#jcap-main, [class*=jcap]').className,
        id: document.querySelector('#jcap-main, [class*=jcap]').id,
        inner: document.querySelector('#jcap-main, [class*=jcap]').outerHTML.slice(0, 1000),
      } : null,
    };
  });
  console.log('\njdCAP 状态:', JSON.stringify(jcapState, null, 2));

  // 看全局 window
  const globals = await page.evaluate(() => {
    const jcapKeys = Object.keys(window).filter(k => k.toLowerCase().includes('jcap') || k.toLowerCase().includes('captcha') || k.toLowerCase().includes('cap'));
    return {
      jcapRelated: jcapKeys,
      hasRequireCaptcha: typeof window.requireCaptchaPc,
      hasJcapMain: typeof window.jcapMain,
      hasJcapInfo: typeof window.jcapInfo,
    };
  });
  console.log('\nGlobals:', JSON.stringify(globals, null, 2));

  // 截图
  await page.screenshot({ path: '/tmp/jd_track/jcap_state.png', fullPage: true });

  await browser.close();
})();
