#!/usr/bin/env node
/**
 * 京东登录 - 真实流程 v3 (深度分析 JDValidate-wrap)
 *
 * 目的: 找到真实验证码类型 (jdSlide 滑块 vs jcap 文字点击 vs 其他)
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

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
  console.log(`[REALFLOW-V3] USERNAME: ${USERNAME}`);

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
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService|uc\/login|seq\.jd|gia\.jd|jra\.jd|track\.jrd|safeverify|smart\.jd|jd\.com\/jdvalidate|joybuy\.com\/jdvalidate/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('error') || t.includes('jdSlide') || t.includes('JDValidate') || t.includes('captcha') || t.includes('ivs') || t.includes('jcaptcha')) {
      console.log('  [browser]', t);
    }
  });

  console.log('\n[1] 打开 login...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  console.log('\n[2] 输入账号密码...');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', USERNAME, { delay: 50 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', PASSWORD, { delay: 50 });
  await sleep(500);

  console.log('\n[3] 点击 .login-btn...');
  await page.click('.login-btn');
  await sleep(8000);

  // 深度分析 JDValidate-wrap
  console.log('\n[4] 分析真实验证码:');
  const analysis = await page.evaluate(() => {
    const out = {};

    // 1. JDValidate-wrap 内部结构
    const wrap = document.querySelector('.JDValidate-wrap, [id=slideAuthCode]');
    if (wrap) {
      out.wrapHTML = wrap.outerHTML.slice(0, 2000);
      out.wrapChildren = Array.from(wrap.children).map(c => ({
        tag: c.tagName,
        cls: c.className,
        id: c.id,
        w: c.offsetWidth,
        h: c.offsetHeight,
        innerText: c.innerText ? c.innerText.slice(0, 100) : null,
        innerHTML: c.innerHTML ? c.innerHTML.slice(0, 500) : null,
      }));
    }

    // 2. iframe
    const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
      src: f.src,
      id: f.id,
      name: f.name,
      w: f.offsetWidth,
      h: f.offsetHeight,
    }));
    out.iframes = iframes;

    // 3. 找所有 image 和 canvas
    out.images = Array.from(document.querySelectorAll('img')).filter(i => i.offsetWidth > 50).map(i => ({
      src: i.src.slice(0, 100),
      w: i.offsetWidth,
      h: i.offsetHeight,
      cls: i.className,
    }));
    out.canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      w: c.offsetWidth,
      h: c.offsetHeight,
      cls: c.className,
    }));

    // 4. 找 globals
    out.globals = {
      jdSlide: typeof window.jdSlide,
      jdJRV: typeof window.JDJRV,
      jcap: typeof window.jdCAP,
      slideJS: typeof window.slide_ujs,
      JDJRV: typeof window.JDJRV,
      jdValidate: typeof window.jdValidate,
      slide_ujs: typeof window.slide_ujs,
      JDJRV_slide: typeof window.JDJRV_slide,
      initJdSlide: typeof window.initJdSlide,
      initJcap: typeof window.initJcap,
      initJDValidate: typeof window.initJDValidate,
      hasjQuery: typeof window.jQuery,
      has$: typeof window.$,
    };

    // 5. 找脚本
    out.scripts = Array.from(document.scripts).map(s => s.src).filter(s => s).filter(s => !s.includes('jquery') && !s.includes('ga.')).slice(-20);

    return out;
  });
  console.log('  globals:', JSON.stringify(analysis.globals, null, 2));
  console.log('  iframes:', analysis.iframes.length);
  for (const f of analysis.iframes) {
    console.log('    ', JSON.stringify(f));
  }
  console.log('  wrapChildren:');
  for (const c of analysis.wrapChildren || []) {
    console.log('    ', c.tag, c.cls, c.id, `${c.w}x${c.h}`, '|', (c.innerText || '').slice(0, 50));
  }
  console.log('  images:', analysis.images.length);
  for (const i of analysis.images.slice(0, 5)) {
    console.log('    ', `${i.w}x${i.h}`, i.src.slice(0, 80));
  }
  console.log('  scripts (最后 20):');
  for (const s of analysis.scripts || []) {
    console.log('    ', s);
  }

  // 看 respLog 中的关键接口
  console.log('\n[5] respLog:');
  for (const r of respLog) {
    console.log(`  [${r.status}] ${r.url.slice(0, 120)}`);
    if (r.body) console.log(`      body: ${r.body.slice(0, 150)}`);
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_realflow_v3.png', fullPage: true });
  await browser.close();
})();
