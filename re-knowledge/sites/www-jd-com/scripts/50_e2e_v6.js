#!/usr/bin/env node
/**
 * 京东登录 - 真实流程 v6 (深度分析 jdSlide 实例)
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT = '/workspace/re-knowledge/sites/www-jd-com';

const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const USERNAME = `jdtest${randomStr(6)}@163.com`;
  const PASSWORD = `Pwd${randomStr(8)}!@#`;
  console.log(`[V6] USERNAME: ${USERNAME}`);

  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768',
    ],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    window.__sUrl = null;
    const origAppend = HTMLHeadElement.prototype.appendChild;
    HTMLHeadElement.prototype.appendChild = function(node) {
      if (node && node.tagName === 'SCRIPT' && node.src && node.src.includes('/slide/s.html')) {
        window.__sUrl = node.src;
      }
      return origAppend.call(this, node);
    };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService|uc\/login|seq\.jd|gia\.jd|jra\.jd|track\.jrd|safeverify|smart\.jd|ivs\.jd/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', USERNAME, { delay: 50 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', PASSWORD, { delay: 50 });
  await sleep(500);

  // 点击登录让 loginService 校验
  await page.click('.login-btn');
  await sleep(5000);

  // 看 loginService 响应
  console.log('\nloginService 响应:');
  for (const r of respLog.filter(r => r.url.includes('loginService'))) {
    console.log(`  [${r.status}] ${r.body.slice(0, 400)}`);
  }

  // 强制调用 smartInitSlide
  await page.evaluate(() => {
    if (typeof window.smartInitSlide === 'function') window.smartInitSlide();
  });
  await sleep(8000);

  // 看 jdSlide 实例内部
  const inner = await page.evaluate(() => {
    if (!window.jdSlide) return null;
    const j = window.jdSlide;
    return {
      w: j.w,
      product: j.product,
      appId: j.appId,
      scene: j.scene,
      apiServer: j.apiServer,
      gData: j.gData ? {
        challenge: j.gData.challenge,
        y: j.gData.y,
        bg: j.gData.bg ? j.gData.bg.slice(0, 50) + '...' : null,
        patch: j.gData.patch ? j.gData.patch.slice(0, 50) + '...' : null,
      } : null,
      passValidate: j.passValidate,
      isDraging: j.isDraging,
      mousePos: j.mousePos ? j.mousePos.length : 0,
      validateID: j.validateID,
      callback: typeof j.callback,
    };
  });
  console.log('\njdSlide 实例:');
  console.log(JSON.stringify(inner, null, 2));

  // 看 JDJRV 元素
  const jdEls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*=JDJRV]')).map(e => ({
      cls: e.className,
      id: e.id,
      w: e.offsetWidth,
      h: e.offsetHeight,
      inner: e.outerHTML.slice(0, 300),
    }));
  });
  console.log(`\nJDJRV 元素 (${jdEls.length}):`);
  for (const e of jdEls.slice(0, 5)) {
    console.log(`  ${e.cls} ${e.w}x${e.h}: ${e.inner.slice(0, 200)}`);
  }

  // 看 respLog 中 g.html
  console.log('\ng.html / s.html 响应:');
  for (const r of respLog.filter(r => r.url.includes('g.html') || r.url.includes('s.html'))) {
    console.log(`  [${r.status}] ${r.url.slice(0, 100)}`);
    console.log(`    ${r.body.slice(0, 400)}`);
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_v6_state.png', fullPage: true });

  fs.writeFileSync('/tmp/jd_track/e2e_v6_resps.json', JSON.stringify(respLog, null, 2));

  await browser.close();
})();
