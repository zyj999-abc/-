#!/usr/bin/env node
/**
 * 京东登录 - 真实 headed 浏览器端到端
 * 用 xvfb-run 启动 headed 模式, 多次点击登录触发 jdSlide
 *
 * 启动方式: xvfb-run -a node scripts/51_realheaded.js
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
  console.log(`[REAL-HEADED] USERNAME: ${USERNAME}`);

  // 启动 headed 模式 (新 puppeteer API: headless: false)
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: false,  // ← 关键: headed 模式
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768',
      '--start-maximized',
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
    window.__slideCallback = null;
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

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('error') || t.includes('jdSlide') || t.includes('slider') || t.includes('validate') || t.includes('login')) {
      console.log('  [browser]', t);
    }
  });

  console.log('\n[1] 打开 login...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 真实输入
  console.log('\n[2] 真实输入账号密码...');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', USERNAME, { delay: 80 });
  await sleep(500);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', PASSWORD, { delay: 80 });
  await sleep(500);

  // 多次点击登录 (第 1 次: 校验, 第 2-3 次: 触发 jdSlide)
  for (let click = 1; click <= 5; click++) {
    console.log(`\n[3.${click}] 第 ${click} 次点击 .login-btn...`);
    // 检查 btn 是否可点
    const btnState = await page.evaluate(() => {
      const b = document.querySelector('.login-btn');
      if (!b) return null;
      return { display: getComputedStyle(b).display, disabled: b.disabled, dataCode: b.getAttribute('data-code') };
    });
    console.log(`  btnState: ${JSON.stringify(btnState)}`);

    await page.click('.login-btn');
    await sleep(3000);

    // 看 loginService 响应
    const loginResps = respLog.filter(r => r.url.includes('loginService'));
    if (loginResps.length > 0) {
      console.log(`  loginService 最新:`);
      const last = loginResps[loginResps.length - 1];
      console.log(`    [${last.status}] ${last.body.slice(0, 300)}`);
    }

    // 检查是否出现 jdSlide
    const check = await page.evaluate(() => {
      return {
        jdSlideExists: !!window.jdSlide,
        useSlideAuthCode: window.useSlideAuthCode,
        JDJRVCount: document.querySelectorAll('[class*=JDJRV]').length,
        jdSlideType: typeof window.jdSlide,
        gData: window.jdSlide && window.jdSlide.gData ? {
          y: window.jdSlide.gData.y,
          challenge: window.jdSlide.gData.challenge,
          patchLen: window.jdSlide.gData.patch ? window.jdSlide.gData.patch.length : 0,
          bgLen: window.jdSlide.gData.bg ? window.jdSlide.gData.bg.length : 0,
        } : null,
      };
    });
    console.log(`  check: ${JSON.stringify(check)}`);

    // 如果 jdSlide 已经触发 + gData 有 patch/bg, 跳出循环
    if (check.jdSlideExists && check.gData && check.gData.patchLen > 0) {
      console.log(`  ✅ jdSlide 触发 + gData 拿到 patch/bg!`);
      break;
    }

    // 如果 jdSlide 触发但 gData 没 patch, 可能需要再等
    if (check.jdSlideExists) {
      console.log(`  等待 gData 加载...`);
      await sleep(5000);
      const recheck = await page.evaluate(() => {
        return window.jdSlide && window.jdSlide.gData ? {
          y: window.jdSlide.gData.y,
          challenge: window.jdSlide.gData.challenge,
          patchLen: window.jdSlide.gData.patch ? window.jdSlide.gData.patch.length : 0,
          bgLen: window.jdSlide.gData.bg ? window.jdSlide.gData.bg.length : 0,
        } : null;
      });
      console.log(`  recheck gData: ${JSON.stringify(recheck)}`);
      if (recheck && recheck.patchLen > 0) break;
    }
  }

  // 最终状态
  const finalState = await page.evaluate(() => {
    return {
      jdSlideExists: !!window.jdSlide,
      jdSlideMethods: window.jdSlide ? Object.keys(window.jdSlide).slice(0, 30) : null,
      gData: window.jdSlide && window.jdSlide.gData ? {
        y: window.jdSlide.gData.y,
        challenge: window.jdSlide.gData.challenge,
        patchLen: window.jdSlide.gData.patch ? window.jdSlide.gData.patch.length : 0,
        bgLen: window.jdSlide.gData.bg ? window.jdSlide.gData.bg.length : 0,
      } : null,
      JDJRV: Array.from(document.querySelectorAll('[class*=JDJRV]')).map(e => e.className + ' size=' + e.offsetWidth + 'x' + e.offsetHeight).slice(0, 5),
    };
  });
  console.log('\n最终状态:', JSON.stringify(finalState, null, 2));

  // 等 btn 出现
  let btnInfo = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    btnInfo = await page.evaluate(() => {
      const btn = document.querySelector('.JDJRV-slide-btn');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (btnInfo && btnInfo.w > 0 && btnInfo.h > 0) {
      console.log(`  btn 出现 (i=${i}s): ${JSON.stringify(btnInfo)}`);
      break;
    }
  }

  if (!btnInfo) {
    console.log('  btn 没出现, 退出');
    await page.screenshot({ path: '/tmp/jd_track/realheaded_no_btn.png', fullPage: true });
    fs.writeFileSync('/tmp/jd_track/realheaded_resps.json', JSON.stringify(respLog, null, 2));
    await browser.close();
    return;
  }

  // 缺口识别
  const gData = finalState.gData;
  let targetX = 138;
  if (gData && gData.patchLen > 0 && gData.bgLen > 0) {
    const j = await page.evaluate(() => ({
      patch: window.jdSlide.gData.patch,
      bg: window.jdSlide.gData.bg,
    }));
    fs.writeFileSync('/tmp/jd_track/g2_patch.png', Buffer.from(j.patch, 'base64'));
    fs.writeFileSync('/tmp/jd_track/g2_bg.png', Buffer.from(j.bg, 'base64'));
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
  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const r = btn.getBoundingClientRect();
    btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
    return { startX: r.x + r.width/2, startY: r.y + r.height/2 };
  });
  console.log(`  setup: ${JSON.stringify(setup)}`);

  console.log('\n[4] 真实 mouse 拖动...');
  await page.mouse.move(setup.startX, setup.startY);
  await sleep(200);
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, setup.startX, setup.startY);
  await sleep(150);
  try { await page.mouse.down(); } catch (e) {}
  await sleep(100);

  const N = 60;
  const totalMs = 2200;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const ease = 1 - Math.pow(1 - t, 2.5);
    const xJitter = (Math.random() - 0.5) * 1.5;
    const yJitter = (Math.random() - 0.5) * 2.0;
    const x = setup.startX + targetX * ease + xJitter;
    const y = setup.startY + yJitter + Math.sin(t * Math.PI * 3) * 0.5;
    await page.mouse.move(x, y, { steps: 1 });
    const dt = (totalMs / N) * (0.7 + Math.random() * 0.6);
    await sleep(dt);
  }
  await sleep(400);
  await page.mouse.up();
  console.log('  拖动完成');
  await sleep(10000);

  // s.html 响应
  const sResps = respLog.filter(r => r.url.includes('s.html'));
  console.log(`\n[5] s.html 响应 (${sResps.length} 条):`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  // loginService 后续
  const loginResps2 = respLog.filter(r => r.url.includes('loginService'));
  console.log(`\n[6] loginService 响应 (${loginResps2.length} 条):`);
  for (const r of loginResps2) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  const sUrl = await page.evaluate(() => window.__sUrl);
  console.log(`\n  __sUrl: ${sUrl ? sUrl.slice(0, 200) + '...' : 'null'}`);

  // cookies
  const cookies = await page.cookies();
  const useful = cookies.filter(c => c.name.match(/pt_|3AB9D|whl|eid|sess|sso|user|key/i));
  console.log(`\n[7] cookies (${useful.length}/${cookies.length}):`);
  for (const c of useful) {
    console.log(`  ${c.name}: ${c.value.slice(0, 60)}`);
  }

  await page.screenshot({ path: '/tmp/jd_track/realheaded_final.png', fullPage: true });

  fs.writeFileSync('/tmp/jd_track/realheaded_resps.json', JSON.stringify(respLog, null, 2));

  await browser.close();
})();
