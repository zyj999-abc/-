#!/usr/bin/env node
/**
 * 京东登录 - 端到端测试 v3
 * ==========================================
 *
 * 关键步骤:
 *   1. 真实 Chrome + 反检测打开 login page
 *   2. 填账号密码
 *   3. 创建 jdSlide 容器 + initJdSlide
 *   4. 等待 g.html 响应（拿 patch/bg）
 *   5. 缺口识别 (OpenCV) 算出 target_x
 *   6. 真实 mouse 拖动 (根据 target_x 调整)
 *   7. 等 s.html 响应 (服务端校验)
 *   8. 拿 callback.validate
 *   9. 触发 loginService 拿 cookie
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

  // 全面反检测
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
    window.__slideCallback = null;

    const origAppend = HTMLHeadElement.prototype.appendChild;
    HTMLHeadElement.prototype.appendChild = function(node) {
      if (node && node.tagName === 'SCRIPT' && node.src) {
        if (node.src.includes('/slide/s.html')) {
          window.__sUrl = node.src;
          console.log('[intercept] s.html script:', node.src.slice(0, 100));
        }
      }
      return origAppend.call(this, node);
    };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService|uc\/login|seq\.jd|gia\.jd|jra\.jd|track\.jrd|safeverify/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[intercept]') || t.includes('[callback]') || t.includes('jdSlide') || t.includes('slide')) {
      console.log('  [browser]', t);
    }
  });

  console.log('\n[1] 打开 passport.jd.com/uc/login ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 填账号密码
  console.log('\n[2] 填账号密码...');
  await page.evaluate((u, p) => {
    const a = document.querySelector('#loginname');
    const p1 = document.querySelector('#nloginpwd');
    if (a) { a.value = u; a.dispatchEvent(new Event('input', { bubbles: true })); }
    if (p1) { p1.value = p; p1.dispatchEvent(new Event('input', { bubbles: true })); }
  }, USERNAME, PASSWORD);
  await new Promise(r => setTimeout(r, 1000));

  // 创建 jdSlide 容器
  console.log('\n[3] 创建 jdSlide 容器 + initJdSlide...');
  await page.evaluate(() => {
    if (!document.querySelector('#jd_slide_container')) {
      const div = document.createElement('div');
      div.id = 'jd_slide_container';
      div.style.cssText = 'position:fixed;top:200px;left:400px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
      document.body.appendChild(div);
    }
  });
  await new Promise(r => setTimeout(r, 500));

  // 初始化 jdSlide (callback 保存到 __slideData)
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
              console.log('[callback] success=' + s + ' message=' + m + ' validate=' + v);
            } catch (e) {
              console.log('[callback] err:', e.message);
            }
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
        } catch (e) {
          console.log('initJdSlide err:', e.message);
          resolve();
        }
        setTimeout(resolve, 60000);
      }
      if (typeof initJdSlide === 'function') {
        doInit();
      } else {
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
  await new Promise(r => setTimeout(r, 5000));

  // 强制 btn 可见
  await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
  });
  await new Promise(r => setTimeout(r, 500));

  // 等 g.html 拿到 patch/bg
  console.log('\n[4] 等 g.html 响应...');
  await new Promise(r => setTimeout(r, 3000));

  // 找 g.html 拿到的 patch/bg
  const gResps = respLog.filter(r => r.url.includes('g.html'));
  console.log(`  g.html 响应: ${gResps.length} 条`);

  let targetX = 138; // 默认
  if (gResps.length > 0) {
    const gBody = gResps[gResps.length - 1].body;
    // 提取 patch/bg base64
    const m = gBody.match(/\(\{.*"patch":"([^"]+)"/);
    const m2 = gBody.match(/"bg":"([^"]+)"/);
    const m3 = gBody.match(/"y":(\d+)/);
    if (m && m2) {
      const patch = m[1];
      const bg = m2[1];
      fs.writeFileSync('/tmp/jd_track/g2_patch.png', Buffer.from(patch, 'base64'));
      fs.writeFileSync('/tmp/jd_track/g2_bg.png', Buffer.from(bg, 'base64'));
      console.log(`  patch len: ${patch.length}, bg len: ${bg.length}`);

      // 缺口识别
      const pyResult = spawnSync('python3', [
        path.join(PROJECT, 'scripts/jd_slide_fulldemo.py'),
        '/tmp/jd_track/g2_bg.png',
        '/tmp/jd_track/g2_patch.png'
      ], { encoding: 'utf-8' });
      console.log('  python stdout:', pyResult.stdout);
      const gapMatch = pyResult.stdout.match(/缺口 x = (\d+)/);
      if (gapMatch) {
        targetX = parseInt(gapMatch[1]);
        console.log(`  targetX (缺口) = ${targetX}`);
      }
    }
  }

  // 点击登录按钮
  console.log('\n[5] 点击登录按钮...');
  await page.evaluate(() => {
    const btn = document.querySelector('.login-btn');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  // 等 jdSlide btn
  console.log('\n[6] 等 jdSlide btn 出现...');
  let btnInfo = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    btnInfo = await page.evaluate(() => {
      const btn = document.querySelector('.JDJRV-slide-btn');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, display: getComputedStyle(btn).display };
    });
    if (btnInfo && btnInfo.w > 0 && btnInfo.h > 0) {
      console.log(`  btn 出现 (i=${i}):`, btnInfo);
      break;
    }
  }

  if (!btnInfo || btnInfo.w === 0) {
    console.log('  btn 仍未出现, 退出');
    await page.screenshot({ path: '/tmp/jd_track/e2e_no_btn.png', fullPage: true });
    await browser.close();
    return;
  }

  // 重新计算 btn 位置（jdSlide 容器 bg = btn.parentElement）
  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const bg = btn ? btn.parentElement : null;
    const r = btn ? btn.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    const bgR = bg ? bg.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    return { startX: r.x + r.width/2, startY: r.y + r.height/2, endX: bgR.x + r.width/2 + 138, bgWidth: bgR.width };
  });
  console.log(`  setup: startX=${setup.startX}, startY=${setup.startY}, targetX=${targetX}`);

  // 用真实 mouse 操作触发拖动
  console.log('\n[7] 真实 mouse 拖动...');
  await page.mouse.move(setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 100));
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 200));

  for (let i = 1; i <= 55; i++) {
    const t = i / 55;
    const ease = 1 - Math.pow(1 - t, 2.5);
    const x = setup.startX + targetX * ease;
    const y = setup.startY + Math.sin(t * Math.PI * 2.5) * 1.2;
    await page.mouse.move(x, y, { steps: 1 });
    await new Promise(r => setTimeout(r, 20 + Math.random() * 25));
  }
  await new Promise(r => setTimeout(r, 500));
  await page.mouse.up();
  console.log('  拖动完成');
  await new Promise(r => setTimeout(r, 10000));

  // 看 callback
  const cb = await page.evaluate(() => {
    const data = window.__slideData;
    if (!data) return null;
    const out = {};
    try { out.success = data.getSuccess ? data.getSuccess() : null; } catch (e) {}
    try { out.message = data.getMessage ? data.getMessage() : null; } catch (e) {}
    try { out.validate = data.getValidate ? data.getValidate() : null; } catch (e) {}
    return out;
  });
  console.log('\n[8] jdSlide callback:', JSON.stringify(cb, null, 2));

  // sUrl
  const sUrl = await page.evaluate(() => window.__sUrl);
  console.log('\n[9] sUrl:', sUrl ? sUrl.slice(0, 200) + '...' : 'null');

  // s.html 响应
  const sResps = respLog.filter(r => r.url.includes('s.html'));
  console.log(`\n[10] s.html 响应 (${sResps.length} 条):`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.body.slice(0, 200)}`);
  }

  // cookies
  const cookies = await page.cookies();
  const useful = cookies.filter(c => c.name.match(/pt_|3AB9D|whl|eid|sess/i));
  console.log('\n[11] cookies (过滤):', useful.length, '/', cookies.length);
  for (const c of useful) {
    console.log(`  ${c.name}: ${c.value.slice(0, 50)}...`);
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_v3.png', fullPage: true });

  fs.writeFileSync('/tmp/jd_track/e2e_v3_resps.json', JSON.stringify(respLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/e2e_v3_credentials.json', JSON.stringify({ username: USERNAME, password: PASSWORD, sUrl, cb, targetX, cookies: useful }, null, 2));

  await browser.close();
})();
