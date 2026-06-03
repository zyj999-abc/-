#!/usr/bin/env node
/**
 * 京东登录 - 端到端 v4 (协议化 s.html)
 * =====================================
 *
 * 思路:
 *   1. 真实 Chrome 拿到 sUrl/eid/jsTk (设备指纹 OK)
 *   2. 用抓到的 sUrl 直接重新 fetch s.html (服务端校验)
 *   3. 如果服务端仍然 fail, 说明是设备指纹问题
 *   4. 如果服务端 success, 说明 d 算法正确
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

  console.log('\n[1] 打开 login...');
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

  await page.evaluate(async () => {
    return new Promise((resolve) => {
      function doInit() {
        try {
          window.__slideCallback = (d) => {
            window.__slideData = d;
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
          resolve();
        }
        setTimeout(resolve, 30000);
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

  await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
  });
  await new Promise(r => setTimeout(r, 500));

  await new Promise(r => setTimeout(r, 3000));
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

  console.log('\n[4] 点击登录按钮...');
  await page.evaluate(() => {
    const btn = document.querySelector('.login-btn');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  // 等 btn
  let btnInfo = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    btnInfo = await page.evaluate(() => {
      const btn = document.querySelector('.JDJRV-slide-btn');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (btnInfo && btnInfo.w > 0) break;
  }
  if (!btnInfo) { await browser.close(); return; }

  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const r = btn.getBoundingClientRect();
    return { startX: r.x + r.width/2, startY: r.y + r.height/2 };
  });
  console.log(`  setup: ${JSON.stringify(setup)}, targetX=${targetX}`);

  console.log('\n[5] 真实 mouse 拖动 (多步骤)...');
  // 只用 dispatchEvent 触发 mousedown, 然后 page.mouse.move + up
  await page.mouse.move(setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 150));

  // 多步 mousemove (60 步)
  // page.mouse.down() 触发 mousePressed (jdSlide 的 b 函数已由 dispatchEvent 触发)
  // 但 puppeteer 的 mouse.up 需要先 mouse.down, 否则抛错
  // 这里再调一次 page.mouse.down 不会重复触发 jdSlide (jdSlide b 函数检查 a.isDraging)
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 50));
  for (let i = 1; i <= 60; i++) {
    const t = i / 60;
    const ease = 1 - Math.pow(1 - t, 2.5);
    const x = setup.startX + targetX * ease;
    const y = setup.startY + Math.sin(t * Math.PI * 2.5) * 0.8;
    await page.mouse.move(x, y, { steps: 1 });
    await new Promise(r => setTimeout(r, 15 + Math.random() * 20));
  }
  await new Promise(r => setTimeout(r, 300));
  await page.mouse.up();
  console.log('  拖动完成');
  await new Promise(r => setTimeout(r, 8000));

  // 拿 sUrl
  const sUrl = await page.evaluate(() => window.__sUrl);
  console.log('\n[6] sUrl:', sUrl ? sUrl.slice(0, 200) : 'null');

  // s.html 响应
  const sResps = respLog.filter(r => r.url.includes('s.html'));
  console.log(`\n[7] s.html 响应 (${sResps.length} 条):`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  // 协议化重提交 sUrl (用 fetch 看服务端是否成功)
  if (sUrl) {
    console.log('\n[8] 协议化重提交 sUrl...');
    const result = await page.evaluate(async (url) => {
      return new Promise((resolve) => {
        const cb = 'jsonp_r_' + Date.now();
        window[cb] = function(data) {
          resolve({ type: 'success', data });
        };
        const s = document.createElement('script');
        s.src = url.replace(/&callback=jsonp_\d+/, `&callback=${cb}`);
        s.onerror = () => resolve({ type: 'error' });
        setTimeout(() => resolve({ type: 'timeout' }), 10000);
        document.head.appendChild(s);
      });
    }, sUrl);
    console.log('  重提交结果:', JSON.stringify(result, null, 2));
  }

  // cookies
  const cookies = await page.cookies();
  const useful = cookies.filter(c => c.name.match(/pt_|3AB9D|whl|eid|sess/i));
  console.log('\n[9] cookies:', useful.length);
  for (const c of useful) {
    console.log(`  ${c.name}: ${c.value.slice(0, 50)}...`);
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_v4.png', fullPage: true });

  fs.writeFileSync('/tmp/jd_track/e2e_v4_resps.json', JSON.stringify(respLog, null, 2));

  await browser.close();
})();
