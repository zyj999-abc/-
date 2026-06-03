#!/usr/bin/env node
/**
 * 京东登录 - 端到端 v5 (优化轨迹 + 重试)
 * ==========================================
 *
 * 改进:
 *   - 60+ 步真实人行为轨迹
 *   - 慢启动 + 中段加速 + 末段减速
 *   - y 方向大幅抖动
 *   - dt 不均匀
 *   - 重试机制 (3 次)
 *   - 等待 callback 真实触发
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

async function tryLogin(page, USERNAME, PASSWORD, attempt = 1) {
  console.log(`\n========== 尝试 #${attempt} ==========`);
  const respLog = [];
  let sUrl = null;
  let cbResult = null;

  const respHandler = async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService|uc\/login|seq\.jd|gia\.jd|jra\.jd|track\.jrd|safeverify/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  };
  page.on('response', respHandler);

  // 拦截 script
  await page.evaluate(() => {
    if (!document.querySelector('#jd_slide_container')) {
      const div = document.createElement('div');
      div.id = 'jd_slide_container';
      div.style.cssText = 'position:fixed;top:200px;left:400px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
      document.body.appendChild(div);
    }
  });

  // 填账号密码
  await page.evaluate((u, p) => {
    const a = document.querySelector('#loginname');
    const p1 = document.querySelector('#nloginpwd');
    if (a) { a.value = u; a.dispatchEvent(new Event('input', { bubbles: true })); }
    if (p1) { p1.value = p; p1.dispatchEvent(new Event('input', { bubbles: true })); }
  }, USERNAME, PASSWORD);
  await sleep(500);

  // 初始化 jdSlide
  await page.evaluate(async () => {
    return new Promise((resolve) => {
      function doInit() {
        try {
          window.__slideCallback = (d) => {
            window.__slideData = d;
            try {
              const s = d.getSuccess ? d.getSuccess() : null;
              const m = d.getMessage ? d.getMessage() : null;
              const v = d.getValidate ? d.getValidate() : null;
              console.log('[browser callback] success=' + s + ' message=' + m + ' validate=' + (v || '').slice(0, 30));
            } catch (e) {}
            resolve();
          };
          initJdSlide({
            id: 'jd_slide_container',
            protocol: 'https',
            lang: 'zh-CN',
            product: 'embed',
            scene: 'login_pc',
            appId: '1604ebb2287',
            width: 360,
            account: 'jd_test_user_12345',
          }, window.__slideCallback);
        } catch (e) { resolve(); }
        setTimeout(resolve, 30000);
      }
      if (typeof initJdSlide === 'function') doInit();
      else {
        const check = setInterval(() => {
          if (typeof initJdSlide === 'function') {
            clearInterval(check);
            doInit();
          }
        }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 15000);
      }
    });
  });
  await sleep(5000);

  await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
  });

  // 等 g.html
  await sleep(3000);
  const gResps = respLog.filter(r => r.url.includes('g.html'));
  console.log(`  g.html: ${gResps.length} 条`);

  let targetX = 138;
  if (gResps.length > 0) {
    const gBody = gResps[gResps.length - 1].body;
    const m = gBody.match(/"patch":"([^"]+)"/);
    const m2 = gBody.match(/"bg":"([^"]+)"/);
    if (m && m2) {
      fs.writeFileSync('/tmp/jd_track/g2_patch.png', Buffer.from(m[1], 'base64'));
      fs.writeFileSync('/tmp/jd_track/g2_bg.png', Buffer.from(m2, 'base64'));
      const pyResult = spawnSync('python3', [
        path.join(PROJECT, 'scripts/jd_slide_fulldemo.py'),
        '/tmp/jd_track/g2_bg.png',
        '/tmp/jd_track/g2_patch.png'
      ], { encoding: 'utf-8' });
      const gapMatch = pyResult.stdout.match(/缺口 x = (\d+)/);
      if (gapMatch) targetX = parseInt(gapMatch[1]);
      console.log(`  targetX = ${targetX}`);
    }
  }

  // 点击登录
  await page.evaluate(() => {
    const btn = document.querySelector('.login-btn');
    if (btn) btn.click();
  });
  await sleep(3000);

  // 等 btn
  let btnInfo = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    btnInfo = await page.evaluate(() => {
      const btn = document.querySelector('.JDJRV-slide-btn');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (btnInfo && btnInfo.w > 0) break;
  }
  if (!btnInfo) { console.log('  btn 不出现'); page.off('response', respHandler); return null; }

  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const r = btn.getBoundingClientRect();
    return { startX: r.x + r.width/2, startY: r.y + r.height/2 };
  });
  console.log(`  setup: ${JSON.stringify(setup)}, targetX=${targetX}`);

  // 真实拖动 - 慢速 (1800ms 总时长)
  await page.mouse.move(setup.startX, setup.startY);
  await sleep(200);
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, setup.startX, setup.startY);
  await sleep(150);
  await page.mouse.down();
  await sleep(100);

  // 70 步 mousemove
  const totalMs = 1800;
  const nSteps = 70;
  for (let i = 1; i <= nSteps; i++) {
    const t = i / nSteps;
    // ease-out cubic (慢启动, 中段快, 末段慢)
    const ease = 1 - Math.pow(1 - t, 3);
    // 抖动
    const xJitter = (Math.random() - 0.5) * 1.5;
    const yJitter = (Math.random() - 0.5) * 2.5;
    const x = setup.startX + (targetX * ease) + xJitter;
    const y = setup.startY + yJitter;
    await page.mouse.move(x, y, { steps: 1 });
    await sleep(totalMs / nSteps + Math.random() * 8);
  }
  await sleep(300);
  await page.mouse.up();
  console.log('  拖动完成');
  await sleep(10000);

  sUrl = await page.evaluate(() => window.__sUrl);
  const slideData = await page.evaluate(() => {
    const data = window.__slideData;
    if (!data) return null;
    const out = {};
    try { out.success = data.getSuccess ? data.getSuccess() : null; } catch (e) {}
    try { out.message = data.getMessage ? data.getMessage() : null; } catch (e) {}
    try { out.validate = data.getValidate ? data.getValidate() : null; } catch (e) {}
    return out;
  });

  console.log(`  sUrl: ${sUrl ? sUrl.slice(0, 100) + '...' : 'null'}`);
  console.log(`  callback: ${JSON.stringify(slideData)}`);

  const sResps = respLog.filter(r => r.url.includes('s.html'));
  for (const r of sResps.slice(-1)) {
    console.log(`  s.html 最新响应: ${r.body.slice(0, 200)}`);
  }

  cbResult = slideData;
  page.off('response', respHandler);

  return { sUrl, cbResult, respLog };
}

(async () => {
  const USERNAME = `jdtest${randomStr(6)}@163.com`;
  const PASSWORD = `Pwd${randomStr(8)}!@#`;
  console.log(`[E2E] USERNAME: ${USERNAME}`);
  console.log(`[E2E] PASSWORD: ${PASSWORD}`);

  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
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
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Native Client' },
      ],
    });
    window.chrome = {
      runtime: { PlatformOs: {}, RequestUpdateCheckStatus: {}, OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, Action: {} },
      loadTimes: () => ({}),
      csi: () => ({}),
    };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    window.__sUrl = null;
    window.__gData = null;
    window.__slideData = null;
    const origAppend = HTMLHeadElement.prototype.appendChild;
    HTMLHeadElement.prototype.appendChild = function(node) {
      if (node && node.tagName === 'SCRIPT' && node.src) {
        if (node.src.includes('/slide/s.html')) {
          window.__sUrl = node.src;
        }
      }
      return origAppend.call(this, node);
    };
  });

  // 打开 login
  console.log('\n[init] 打开 login...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(5000);

  let result = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await tryLogin(page, USERNAME, PASSWORD, attempt);
    if (result && result.cbResult && result.cbResult.success === '1') {
      console.log(`\n✅ 尝试 #${attempt} 成功!`);
      break;
    } else {
      console.log(`\n❌ 尝试 #${attempt} 失败`);
      // 重置页面
      await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
      await sleep(3000);
    }
  }

  // cookies
  const cookies = await page.cookies();
  const useful = cookies.filter(c => c.name.match(/pt_|3AB9D|whl|eid|sess/i));
  console.log('\n[最终] cookies:', useful.length);
  for (const c of useful) {
    console.log(`  ${c.name}: ${c.value.slice(0, 50)}...`);
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_v5.png', fullPage: true });

  fs.writeFileSync('/tmp/jd_track/e2e_v5_result.json', JSON.stringify({ username: USERNAME, password: PASSWORD, result, cookies: useful }, null, 2));

  await browser.close();
})();
