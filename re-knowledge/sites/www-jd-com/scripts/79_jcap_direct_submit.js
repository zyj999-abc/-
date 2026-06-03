#!/usr/bin/env node
/**
 * 79_jcap_direct_submit.js
 *
 * 直接找到 captcha 的内部 trajectory 组件，填充 xyList 并提交。
 * 1. 触发验证码
 * 2. 找到 Model 实例（外层 captcha 容器）
 * 3. 找到内部 trajectory 组件
 * 4. 填充 xyList
 * 5. 调用 checkCaptcha 提交
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
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

  const ts = Date.now().toString().slice(-8);
  console.log('[2] 输入账号密码');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', `jd_test_${ts}@163.com`, { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  console.log('[3] 点击登录触发验证码');
  for (let click = 1; click <= 3; click++) {
    await page.click('.login-btn');
    await sleep(5000);
    const hasCaptcha = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
    if (hasCaptcha) {
      console.log(`  点击 ${click} 次后触发验证码`);
      break;
    }
  }
  await sleep(5000);

  // 抓 cpc_img
  const imgInfo = await page.evaluate(() => {
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
    console.log('❌ 没找到 cpc_img');
    await page.screenshot({ path: '/tmp/jd_track/79_no_captcha.png', fullPage: true });
    await browser.close();
    return;
  }

  console.log('[4] cpc_img info:', JSON.stringify(imgInfo));
  const b64 = imgInfo.src.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync('/tmp/jd_track/79_captcha.jpg', Buffer.from(b64, 'base64'));

  // 找 inner component (有 slidingEnd / draw / xyList)
  console.log('[5] 找 inner component');
  const innerInfo = await page.evaluate(() => {
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
    const results = [];
    for (const v of all) {
      if (!v.$options || !v.$options.methods) continue;
      const m = v.$options.methods;
      if (m.slidingEnd || m.draw) {
        results.push({
          tag: v.$options._componentTag || v.$options.name || 'unknown',
          methods: Object.keys(m),
          dataKeys: Object.keys(v.$data || {}),
          // runtimeState keys
          rsKeys: v.runtimeState ? Object.keys(v.runtimeState) : [],
          hasXyList: !!(v.runtimeState && v.runtimeState.xyList !== undefined),
        });
      }
    }
    return results;
  });

  console.log('  inner components:', JSON.stringify(innerInfo, null, 2));

  // 找最具体的 inner component（有 xyList）
  let bestMatch = null;
  for (const c of innerInfo) {
    if (c.hasXyList) {
      bestMatch = c;
      break;
    }
  }
  if (!bestMatch && innerInfo.length > 0) {
    bestMatch = innerInfo[0];
  }

  if (!bestMatch) {
    console.log('  ❌ 没找到 inner component');
    await page.screenshot({ path: '/tmp/jd_track/79_no_inner.png', fullPage: true });
    await browser.close();
    return;
  }

  console.log('[6] best match:', bestMatch.tag);

  // 生成 Z 路径
  console.log('[7] 生成 Z 路径');
  const zPathJson = execSync(
    `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/77_gen_z_path.py ${imgInfo.w} ${imgInfo.h}`,
    { encoding: 'utf-8' }
  );
  const zPath = JSON.parse(zPathJson);
  console.log('  Z 点数:', zPath.points.length);

  // 注入 xyList 到 inner component
  console.log('[8] 注入 xyList 并提交');
  const result = await page.evaluate((points, w, h) => {
    // 找 inner component
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
    if (!target) {
      return { error: 'no target with xyList' };
    }

    // 清空并填充
    target.runtimeState.xyList.length = 0;
    const t0 = Date.now();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // 时间间隔：模拟 15ms 每个点
      const t = t0 + i * 20;
      target.runtimeState.xyList.push([p.x, p.y, t]);
    }

    // 模拟 slidingEnd 流程
    if (target.updateState) target.updateState({ operating: false });

    // 直接调用 checkCaptcha
    if (target.slidingEnd) {
      target.slidingEnd();
      return { ok: true, method: 'slidingEnd' };
    } else if (target.$refs && target.$refs.model && target.$refs.model.checkCaptcha) {
      // 手动调用 checkCaptcha
      const cpc = document.getElementById('cpc_img');
      if (cpc) {
        const r = cpc.getBoundingClientRect();
        const data = {
          x: r.left, y: r.top,
          ht: cpc.clientHeight, wt: cpc.clientWidth,
          list: target.runtimeState.xyList.slice(),
        };
        target.$refs.model.checkCaptcha(data);
        return { ok: true, method: 'manual checkCaptcha' };
      }
    }
    return { error: 'no method to submit' };
  }, zPath.points, imgInfo.w, imgInfo.h);

  console.log('  注入结果:', JSON.stringify(result));

  await sleep(5000);

  // 看响应
  const lastCheck = [...respLog].reverse().find(r => r.url.includes('/check'));
  if (lastCheck) {
    try {
      const j = JSON.parse(lastCheck.body);
      console.log('[9] check 响应:', `tp=${j.tp} code=${j.code} vt=${j.vt ? 'YES' : 'null'}`);
      if (j.vt) {
        fs.writeFileSync('/tmp/jd_track/79_vt.txt', j.vt);
        console.log('  ✅ vt saved!');
      }
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/79_after.png', fullPage: true });

  await browser.close();
})();
