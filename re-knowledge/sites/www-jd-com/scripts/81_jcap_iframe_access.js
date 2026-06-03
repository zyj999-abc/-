#!/usr/bin/env node
/**
 * 81_jcap_iframe_access.js
 *
 * 访问 iframe 内部的 captcha
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('jcap') && url.includes('/api/')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开登录页');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  console.log('[2] 输入账号密码');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', `jd_test_${Date.now().toString().slice(-8)}@163.com`, { delay: 80 });
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  console.log('[3] 多次点击登录触发验证码');
  let triggered = false;
  for (let click = 1; click <= 5; click++) {
    await page.click('.login-btn');
    await sleep(4000);
    // 看是否有 cpc_img
    for (const f of page.frames()) {
      try {
        const has = await f.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
        if (has) {
          console.log(`  ${click} 次后触发, 在 frame ${f.url().slice(0, 50)}`);
          triggered = true;
          break;
        }
      } catch (e) {}
    }
    if (triggered) break;
  }
  await sleep(5000);

  // 在每个 frame 找 cpc_img
  let targetFrame = null;
  for (const f of page.frames()) {
    try {
      const has = await f.evaluate(() => !!document.querySelector('#cpc_img'));
      if (has) {
        targetFrame = f;
        break;
      }
    } catch (e) {}
  }

  if (!targetFrame) {
    console.log('❌ 没找到 captcha frame');
    await page.screenshot({ path: '/tmp/jd_track/81_no_captcha.png', fullPage: true });
    await browser.close();
    return;
  }

  console.log('[4] captcha frame:', targetFrame.url());

  // 抓 cpc_img 在 target frame 中
  const imgInfo = await targetFrame.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc || !cpc.src) return null;
    const r = cpc.getBoundingClientRect();
    return {
      src: cpc.src,
      w: cpc.naturalWidth || cpc.width,
      h: cpc.naturalHeight || cpc.height,
      x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight,
    };
  });

  if (!imgInfo) {
    console.log('❌ target frame 中没找到 cpc_img');
    await browser.close();
    return;
  }

  console.log('[5] cpc_img:', JSON.stringify(imgInfo));
  const b64 = imgInfo.src.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync('/tmp/jd_track/81_captcha.jpg', Buffer.from(b64, 'base64'));

  // 找 inner component
  const innerInfo = await targetFrame.evaluate(() => {
    const findVue = (root) => {
      const found = [];
      const walk = (el) => {
        if (el.__vue__) found.push(el.__vue__);
        for (const c of el.children) walk(c);
      };
      walk(root);
      return found;
    };
    const all = findVue(document.body);
    return all.filter(v => {
      if (!v.$options || !v.$options.methods) return false;
      const m = v.$options.methods;
      return m.slidingEnd || m.draw || m.handleMouseStart || (m.checkCaptcha && v.runtimeState);
    }).map(v => ({
      methods: Object.keys(v.$options.methods),
      dataKeys: Object.keys(v.$data || {}),
      hasRuntimeState: !!v.runtimeState,
      rsKeys: v.runtimeState ? Object.keys(v.runtimeState) : [],
    }));
  });

  console.log('[6] inner components:', JSON.stringify(innerInfo, null, 2));

  // 生成 Z 路径
  const zPathJson = execSync(
    `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/77_gen_z_path.py ${imgInfo.w} ${imgInfo.h}`,
    { encoding: 'utf-8' }
  );
  const zPath = JSON.parse(zPathJson);

  // 注入 xyList 并提交
  const result = await targetFrame.evaluate((points) => {
    const findVue = (root) => {
      const found = [];
      const walk = (el) => {
        if (el.__vue__) found.push(el.__vue__);
        for (const c of el.children) walk(c);
      };
      walk(root);
      return found;
    };
    const all = findVue(document.body);
    let target = null;
    for (const v of all) {
      if (v.runtimeState && v.runtimeState.xyList !== undefined) {
        target = v;
        break;
      }
    }
    if (!target) return { error: 'no target' };

    target.runtimeState.xyList.length = 0;
    const t0 = Date.now();
    for (let i = 0; i < points.length; i++) {
      target.runtimeState.xyList.push([points[i].x, points[i].y, t0 + i * 20]);
    }

    if (target.slidingEnd) {
      target.slidingEnd();
      return { ok: true, method: 'slidingEnd' };
    }
    return { error: 'no slidingEnd method' };
  }, zPath.points);

  console.log('[7] 注入结果:', JSON.stringify(result));

  await sleep(5000);

  // 看响应
  const lastCheck = [...respLog].reverse().find(r => r.url.includes('/check'));
  if (lastCheck) {
    try {
      const j = JSON.parse(lastCheck.body);
      console.log('[8] check 响应:', `tp=${j.tp} code=${j.code} vt=${j.vt ? 'YES' : 'null'}`);
      if (j.vt) {
        fs.writeFileSync('/tmp/jd_track/81_vt.txt', j.vt);
        console.log('  ✅ vt saved!');
      }
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/81_after.png', fullPage: true });

  await browser.close();
})();
