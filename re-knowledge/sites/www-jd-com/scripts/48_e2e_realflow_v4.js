#!/usr/bin/env node
/**
 * 京东登录 - 真实流程 v4 (等待 JDValidate 完全加载)
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
  console.log(`[REALFLOW-V4] USERNAME: ${USERNAME}`);

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
  await sleep(5000);

  // 等 initJdSlide 被调用 (login2025_append.js 自动触发)
  console.log('\n[4] 等 jdSlide 容器出现 (真实 login2025_append.js 触发)...');
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const info = await page.evaluate(() => {
      const wrap = document.querySelector('.JDValidate-wrap, #slideAuthCode, #loginsubmit');
      const btn = document.querySelector('.JDJRV-slide-btn');
      const jds = !!window.jdSlide;
      return {
        wrapExists: !!wrap,
        wrapHTML: wrap ? wrap.outerHTML.slice(0, 200) : null,
        wrapRect: wrap ? { w: wrap.offsetWidth, h: wrap.offsetHeight } : null,
        btnExists: !!btn,
        btnRect: btn ? { w: btn.offsetWidth, h: btn.offsetHeight } : null,
        jdSlideInstance: jds,
        jdSlideType: typeof window.jdSlide,
      };
    });
    if (i % 3 === 0) console.log(`  i=${i}s:`, JSON.stringify(info).slice(0, 250));
    if (info.btnExists && info.btnRect && info.btnRect.w > 0) {
      console.log(`  btn 出现 i=${i}s`);
      break;
    }
  }

  // 拿 gData
  const gData = await page.evaluate(() => {
    if (typeof window.gData === 'undefined') return null;
    return {
      y: window.gData.y,
      challenge: window.gData.challenge,
      apiServer: window.gData.apiServer,
      patch: window.gData.patch,
      bg: window.gData.bg,
    };
  });
  console.log(`  gData: ${gData ? `y=${gData.y} patch=${gData.patch ? gData.patch.length : 0} chars bg=${gData.bg ? gData.bg.length : 0} chars challenge=${gData.challenge}` : 'null'}`);

  // 找 jdSlide btn
  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
    return { startX: r.x + r.width/2, startY: r.y + r.height/2 };
  });
  console.log(`  setup: ${JSON.stringify(setup)}`);

  if (!setup) {
    console.log('  没有 btn, 退出');
    console.log('  respLog 相关:');
    for (const r of respLog.filter(x => x.url.includes('slide') || x.url.includes('ivs'))) {
      console.log(`    [${r.status}] ${r.url.slice(0, 100)}`);
    }
    await page.screenshot({ path: '/tmp/jd_track/e2e_realflow_v4_no_btn.png', fullPage: true });
    await browser.close();
    return;
  }

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

  console.log('\n[5] 真实 mouse 拖动...');
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
  console.log(`\n[6] s.html 响应 (${sResps.length} 条):`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  // loginService 后续
  const loginResps = respLog.filter(r => r.url.includes('loginService'));
  console.log(`\n[7] loginService 响应 (${loginResps.length} 条):`);
  for (const r of loginResps) {
    console.log(`  [${r.status}] ${r.body.slice(0, 300)}`);
  }

  const sUrl = await page.evaluate(() => window.__sUrl);
  console.log(`\n  __sUrl: ${sUrl ? sUrl.slice(0, 200) + '...' : 'null'}`);

  // cookies
  const cookies = await page.cookies();
  const useful = cookies.filter(c => c.name.match(/pt_|3AB9D|whl|eid|sess|sso|user|key/i));
  console.log(`\n[8] cookies (${useful.length}/${cookies.length}):`);
  for (const c of useful) {
    console.log(`  ${c.name}: ${c.value.slice(0, 60)}`);
  }

  await page.screenshot({ path: '/tmp/jd_track/e2e_realflow_v4_final.png', fullPage: true });

  fs.writeFileSync('/tmp/jd_track/e2e_realflow_v4_resps.json', JSON.stringify(respLog, null, 2));

  await browser.close();
})();
