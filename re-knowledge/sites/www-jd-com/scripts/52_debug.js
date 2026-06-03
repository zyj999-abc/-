#!/usr/bin/env node
/**
 * 深度调试 - 真实 headed 浏览器, 看点击 .login-btn 真实发生了什么
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

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
  console.log(`[DEBUG] USERNAME: ${USERNAME}`);

  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  // 抓所有响应 (不限制)
  const allResps = [];
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const method = resp.request().method();
      const status = resp.status();
      let body = '';
      try { body = (await resp.text()).slice(0, 400); } catch (e) {}
      allResps.push({ ts: Date.now(), method, url, status, body });
    } catch (e) {}
  });

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('error') || t.includes('captcha') || t.includes('login') || t.includes('slide') || t.includes('slider')) {
      console.log('  [console]', t);
    }
  });

  // 抓所有请求
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('loginService') || url.includes('uc/login') || url.includes('jcap') || url.includes('iv.jd')) {
      console.log('  [req]', req.method(), url.slice(0, 150));
    }
  });

  page.on('requestfailed', (req) => {
    console.log('  [req-failed]', req.url().slice(0, 150), req.failure()?.errorText);
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 真实输入
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', USERNAME, { delay: 80 });
  await sleep(500);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', PASSWORD, { delay: 80 });
  await sleep(500);

  // 注入 click 监听器 - 看 click 处理函数
  await page.evaluate(() => {
    const btn = document.querySelector('#loginsubmit');
    if (btn) {
      btn.addEventListener('click', (e) => {
        console.log('[click] loginsubmit clicked');
        // 检查所有 hidden 字段
        const all = Array.from(document.querySelectorAll('input[type=hidden], input[name]'));
        const fields = all.map(i => `${i.name || i.id}=${i.value || ''}`).filter(s => !s.includes('='));
        console.log('[click] all fields:', fields.slice(0, 30).join('|'));
      }, true);
    }
  });

  // 看 useSlideAuthCode 状态
  const init = await page.evaluate(() => {
    return {
      useSlideAuthCode: window.useSlideAuthCode,
      smartInitSlideType: typeof window.smartInitSlide,
      jdSlideType: typeof window.jdSlide,
      ParamsSignType: typeof window.ParamsSign,
      SysConfig: window.SysConfig ? Object.keys(window.SysConfig) : null,
      encryptInfo: window.SysConfig ? window.SysConfig.encryptInfo : null,
      slideAppId: document.querySelector('#slideAppId') ? document.querySelector('#slideAppId').value : null,
      authcode: document.querySelector('#authcode') ? document.querySelector('#authcode').value : null,
    };
  });
  console.log('init:', JSON.stringify(init, null, 2));

  // 监听 console 完整
  page.on('console', (msg) => {
    console.log('  [console-all]', msg.type(), msg.text().slice(0, 200));
  });

  // 多次点击
  for (let click = 1; click <= 8; click++) {
    console.log(`\n===== 第 ${click} 次点击 =====`);
    await page.click('.login-btn');
    await sleep(4000);

    // 看 jdSlide 状态
    const state = await page.evaluate(() => {
      return {
        jdSlideExists: !!window.jdSlide,
        jdSlideType: typeof window.jdSlide,
        jdSlideGData: window.jdSlide && window.jdSlide.gData ? {
          y: window.jdSlide.gData.y,
          patchLen: window.jdSlide.gData.patch ? window.jdSlide.gData.patch.length : 0,
          bgLen: window.jdSlide.gData.bg ? window.jdSlide.gData.bg.length : 0,
        } : null,
        useSlideAuthCode: window.useSlideAuthCode,
        JDJRV: document.querySelectorAll('[class*=JDJRV]').length,
        jcapInst: !!window.jdCAP,
      };
    });
    console.log(`state: ${JSON.stringify(state)}`);

    if (state.jdSlideExists && state.jdSlideGData && state.jdSlideGData.patchLen > 0) {
      console.log('✅ 拿到 patch/bg!');
      break;
    }
  }

  // 列出所有 loginService / slide / jcap 请求
  console.log('\n所有 loginService / slide / jcap 请求:');
  for (const r of allResps) {
    if (r.url.includes('loginService') || r.url.includes('iv.jd') || r.url.includes('jcap') || r.url.includes('ivs.jd') || r.url.includes('iv.joybuy')) {
      console.log(`  [${r.status}] ${r.method} ${r.url.slice(0, 150)}`);
    }
  }

  fs.writeFileSync('/tmp/jd_track/debug_all_resps.json', JSON.stringify(allResps, null, 2));
  await browser.close();
})();
