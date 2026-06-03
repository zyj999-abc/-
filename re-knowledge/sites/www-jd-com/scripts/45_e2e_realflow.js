#!/usr/bin/env node
/**
 * 京东登录 - 真实流程端到端
 * ==========================================
 *
 * 真实流程:
 *   1. 打开 passport.jd.com/uc/login
 *   2. 真实 input 账号密码
 *   3. 点击 .login-btn
 *   4. 服务端校验 - 失败 (random 账号) → 触发 jdSlide
 *   5. 完成 jdSlide 拿 validate
 *   6. 自动重试登录 (callback validate)
 *   7. 拿 cookie
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
  // 用真实有效格式的随机账号 (12306@qq.com 这种格式通过率高)
  const USERNAME = `jdtest${randomStr(6)}@163.com`;
  const PASSWORD = `Pwd${randomStr(8)}!@#`;
  console.log(`[E2E-REAL] USERNAME: ${USERNAME}`);
  console.log(`[E2E-REAL] PASSWORD: ${PASSWORD}`);

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
    window.__slideCb = null;
    window.__slideValidated = null;
    window.__allCookies = [];

    const origAppend = HTMLHeadElement.prototype.appendChild;
    HTMLHeadElement.prototype.appendChild = function(node) {
      if (node && node.tagName === 'SCRIPT' && node.src) {
        if (node.src.includes('/slide/s.html')) {
          window.__sUrl = node.src;
          console.log('[intercept-s.html]');
        }
      }
      return origAppend.call(this, node);
    };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService|uc\/login|seq\.jd|gia\.jd|jra\.jd|track\.jrd|safeverify|smart\.jd\.com/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[intercept-s') || t.includes('jdSlide') || t.includes('login') || t.includes('callback')) {
      console.log('  [browser]', t);
    }
  });

  console.log('\n[1] 打开 login 页...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 真实 input (点击 + 键盘输入)
  console.log('\n[2] 点击 #loginname 并真实输入账号...');
  const loginName = await page.$('#loginname');
  if (loginName) {
    await loginName.click({ clickCount: 3 });
    await loginName.type(USERNAME, { delay: 50 });
  }
  await sleep(500);

  console.log('\n[3] 点击 #nloginpwd 并真实输入密码...');
  const pwdInput = await page.$('#nloginpwd');
  if (pwdInput) {
    await pwdInput.click({ clickCount: 3 });
    await pwdInput.type(PASSWORD, { delay: 50 });
  }
  await sleep(500);

  // 检查是否需要图形验证码
  console.log('\n[4] 检查图形验证码...');
  const hasGraphic = await page.evaluate(() => {
    return !!document.querySelector('#graphicCaptchaSessionId, [class*=graphic]');
  });
  if (hasGraphic) console.log('  图形验证码存在');

  console.log('\n[5] 真实点击 .login-btn (触发 jdSlide)...');
  const loginBtn = await page.$('.login-btn');
  if (loginBtn) {
    await loginBtn.click();
  }
  await sleep(5000);

  // 检查 loginService 响应
  console.log('\n[6] loginService 响应:');
  const loginResps = respLog.filter(r => r.url.includes('loginService'));
  for (const r of loginResps.slice(-2)) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  // 等 jdSlide 出现 (在真实流程里, login2024.js 自动触发)
  console.log('\n[7] 等 jdSlide 出现 (真实 login2024.js 触发)...');
  let hasJdSlide = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    hasJdSlide = await page.evaluate(() => {
      return !!document.querySelector('.JDJRV-slide, .slide-authCode-wraper, #jd_slide_container, .JDJRV-wrap, [class*=JDJRV], [id*=JDJRV], [id*=jd_slide]');
    });
    if (hasJdSlide) {
      console.log(`  jdSlide 容器出现 (i=${i}s)`);
      break;
    }
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_realflow1.png', fullPage: true });

  if (!hasJdSlide) {
    console.log('  jdSlide 未出现 - 看页面状态:');
    const pageState = await page.evaluate(() => {
      return {
        url: location.href,
        title: document.title,
        bodyText: document.body.innerText.slice(0, 500),
        allInputs: Array.from(document.querySelectorAll('input')).map(i => ({ id: i.id, name: i.name, type: i.type, value: i.value })),
        errorMessages: Array.from(document.querySelectorAll('.msg-error, .form-msg, .error, [class*=error]')).map(e => e.innerText),
        visibleDivs: Array.from(document.querySelectorAll('div')).filter(d => d.offsetWidth > 100 && d.offsetHeight > 50).map(d => ({ id: d.id, cls: d.className })).slice(0, 20),
      };
    });
    console.log(JSON.stringify(pageState, null, 2));
    await browser.close();
    return;
  }

  // jdSlide 出现 - 等图片加载
  console.log('\n[8] 等 jdSlide 图片加载...');
  await sleep(5000);

  // 检查 btn 位置
  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const bg = btn.parentElement;
    const bgR = bg ? bg.getBoundingClientRect() : r;
    // 强制 btn 可见
    btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
    return { startX: r.x + r.width/2, startY: r.y + r.height/2, bgX: bgR.x, bgY: bgR.y, bgW: bgR.width, bgH: bgR.height };
  });
  console.log(`  setup: ${JSON.stringify(setup)}`);

  // 拿 gData
  const gData = await page.evaluate(() => {
    const data = window.gData;
    if (!data) return null;
    return {
      y: data.y,
      challenge: data.challenge,
      apiServer: data.apiServer,
      patchLen: data.patch ? data.patch.length : 0,
      bgLen: data.bg ? data.bg.length : 0,
    };
  });
  console.log(`  gData: ${JSON.stringify(gData)}`);

  // 缺口识别
  let targetX = 138;
  if (gData && gData.patch && gData.bg) {
    fs.writeFileSync('/tmp/jd_track/g2_patch.png', Buffer.from(gData.patch, 'base64'));
    fs.writeFileSync('/tmp/jd_track/g2_bg.png', Buffer.from(gData.bg, 'base64'));
    const pyResult = spawnSync('python3', [
      path.join(PROJECT, 'scripts/jd_slide_fulldemo.py'),
      '/tmp/jd_track/g2_bg.png',
      '/tmp/jd_track/g2_patch.png'
    ], { encoding: 'utf-8' });
    console.log('  python:', pyResult.stdout.slice(0, 200));
    const gapMatch = pyResult.stdout.match(/缺口 x = (\d+)/);
    if (gapMatch) targetX = parseInt(gapMatch[1]);
  }
  console.log(`  targetX = ${targetX}`);

  // 真实拖动
  console.log('\n[9] 真实 mouse 拖动...');
  await page.mouse.move(setup.startX, setup.startY);
  await sleep(200);

  // 用真实的 dispatchEvent 触发 mousedown (jdSlide 的 slideBtn.onmousedown)
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, setup.startX, setup.startY);
  await sleep(150);

  // puppeteer 的 mouse.down 触发 Chrome 内部 mousePressed
  try { await page.mouse.down(); } catch (e) {}
  await sleep(100);

  // 60 步真实轨迹 (不均匀)
  const N = 60;
  const totalMs = 2200;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    // ease-out (慢启动, 末段减速)
    const ease = 1 - Math.pow(1 - t, 2.5);
    // 自然人手抖动
    const xJitter = (Math.random() - 0.5) * 1.5;
    const yJitter = (Math.random() - 0.5) * 2.0;
    const x = setup.startX + targetX * ease + xJitter;
    const y = setup.startY + yJitter + Math.sin(t * Math.PI * 3) * 0.5;
    await page.mouse.move(x, y, { steps: 1 });
    // 随机停顿 (中段可能更快)
    const dt = (totalMs / N) * (0.7 + Math.random() * 0.6);
    await sleep(dt);
  }
  await sleep(400);
  await page.mouse.up();
  console.log('  拖动完成');
  await sleep(10000);

  // 看 s.html 响应
  console.log('\n[10] s.html 响应:');
  const sResps = respLog.filter(r => r.url.includes('s.html'));
  for (const r of sResps.slice(-1)) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  // 看 loginService 后续响应 (validate 通过后)
  console.log('\n[11] loginService 后续响应 (validate 后):');
  const loginResps2 = respLog.filter(r => r.url.includes('loginService'));
  for (const r of loginResps2.slice(-2)) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  // cookies
  const cookies = await page.cookies();
  const useful = cookies.filter(c => c.name.match(/pt_|3AB9D|whl|eid|sess|sso|user|key/i));
  console.log(`\n[12] cookies (${useful.length}/${cookies.length}):`);
  for (const c of useful) {
    console.log(`  ${c.name}: ${c.value.slice(0, 60)}...`);
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_realflow2.png', fullPage: true });

  fs.writeFileSync('/tmp/jd_track/e2e_realflow_resps.json', JSON.stringify(respLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/e2e_realflow_credentials.json', JSON.stringify({ username: USERNAME, password: PASSWORD, targetX, cookies: useful }, null, 2));

  await browser.close();
})();
