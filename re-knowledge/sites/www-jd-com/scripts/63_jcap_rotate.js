#!/usr/bin/env node
/**
 * 63_jcap_rotate.js
 *
 * 京东 jcap 验证码 = 旋转滑块（type 26 / 25 / 11）：
 * 1. 获取 b1 圆形图
 * 2. 用 OpenCV 检测当前旋转角（基于图片的方向/对称性）
 * 3. 计算需要旋转多少度 → 拖动 slider 反向旋转
 * 4. 验证 vt 拿 token
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
  await page.click('.login-btn');
  await sleep(10000);

  // 抓 respLog 里的 b1 图
  const lastCheck = [...respLog].reverse().find(r => r.url.includes('/check'));
  if (!lastCheck) {
    console.log('❌ 没有 check 响应');
    await browser.close();
    return;
  }
  const checkJson = JSON.parse(lastCheck.body);
  console.log('  check tp=' + checkJson.tp + ' code=' + checkJson.code);

  let b1B64 = null;
  if (checkJson.img) {
    try {
      const inner = JSON.parse(checkJson.img);
      b1B64 = inner.b1;
    } catch (e) {}
  }
  if (!b1B64) {
    console.log('❌ check 响应中没有 b1 图');
    await browser.close();
    return;
  }

  // 保存 b1
  const b1Data = b1B64.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync('/tmp/jd_track/63_b1.png', Buffer.from(b1Data, 'base64'));
  console.log('  b1 saved (', (b1Data.length * 3 / 4 / 1024).toFixed(1), 'KB)');

  // 抓 DOM 状态
  const dom = await page.evaluate(() => {
    const getRect = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    const getInfo = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: el.offsetWidth, h: el.offsetHeight, x: r.x, y: r.y, id: el.id, cls: el.className };
    };
    return {
      tip: (() => {
        const t = document.querySelector('.tip_text.local_tip');
        return t ? t.innerText : null;
      })(),
      mainImg: getInfo('#main_img'),
      slotImg: getInfo('#slot_img'),
      curveMainImg: getInfo('#curve_main_img'),
      cpcImg: getInfo('#cpc_img'),
      dragBox: getInfo('.drag-box'),
      dragDom: (() => {
        const el = document.querySelector('.drag-dom');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          w: el.offsetWidth, h: el.offsetHeight, x: r.x, y: r.y,
          transform: el.style.transform,
          computed: getComputedStyle(el).transform,
        };
      })(),
      sliderTrack: (() => {
        // 找 slider
        const candidates = ['.slider', '.slide-track', '[class*=slider]', '[class*=slide-track]'];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            return { sel, w: el.offsetWidth, h: el.offsetHeight, x: r.x, y: r.y };
          }
        }
        return null;
      })(),
    };
  });
  console.log('\n[4] DOM 状态:');
  console.log('  tip:', dom.tip);
  console.log('  mainImg:', JSON.stringify(dom.mainImg));
  console.log('  slotImg:', JSON.stringify(dom.slotImg));
  console.log('  curveMainImg:', JSON.stringify(dom.curveMainImg));
  console.log('  cpcImg:', JSON.stringify(dom.cpcImg));
  console.log('  dragBox:', JSON.stringify(dom.dragBox));
  console.log('  dragDom:', JSON.stringify(dom.dragDom));
  console.log('  sliderTrack:', JSON.stringify(dom.sliderTrack));

  await page.screenshot({ path: '/tmp/jd_track/63_loaded.png', fullPage: true });

  // 决定 captcha 类型
  let captchaType = 'unknown';
  if (dom.curveMainImg) captchaType = 'curve_drawing';
  else if (dom.cpcImg) captchaType = 'old_slider';
  else if (dom.mainImg && dom.slotImg) captchaType = 'rotate_cube';
  else if (dom.dragBox) captchaType = 'rotate_slider';
  console.log('\n[5] 判定 captcha 类型:', captchaType);

  if (captchaType === 'rotate_cube' || captchaType === 'rotate_slider') {
    // 旋转滑块 / 旋转立方体验证码
    // 1. 用 OpenCV 检测 b1 的旋转角度
    console.log('[6] 用 OpenCV 检测 b1 旋转角度');
    let angle = 0;
    try {
      const detectOut = execSync(
        `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/63_detect_rotation.py /tmp/jd_track/63_b1.png`,
        { timeout: 30000, encoding: 'utf-8' }
      );
      const result = JSON.parse(detectOut);
      angle = result.angle || 0;
      console.log('  检测到旋转角:', angle, '度 (', result.method, ')');
    } catch (e) {
      console.log('  ❌ OpenCV 检测失败:', e.message);
    }

    // 2. 拖动 slider 反向旋转
    const slider = dom.sliderTrack;
    const mainImg = dom.mainImg || dom.dragBox;
    if (!slider || !mainImg) {
      console.log('❌ 找不到 slider 或 mainImg');
      await browser.close();
      return;
    }

    // 估算拖动距离
    // slider width 是最大拖动距离，对应 360 度
    // 但实际可能不是 1:1，先拖到中间看效果
    const startX = slider.x + 30;
    const startY = slider.y + slider.h / 2;
    const sliderWidth = slider.w - 60;  // 减去左右 padding

    // 角度转换为拖动距离（每 360 度 = sliderWidth 像素）
    const dragDistance = (angle / 360) * sliderWidth * 2;  // 乘 2 是经验值
    const endX = startX + Math.max(20, Math.min(sliderWidth, dragDistance));

    console.log(`  拖动 ${startX.toFixed(0)},${startY.toFixed(0)} → ${endX.toFixed(0)},${startY.toFixed(0)} (距离 ${(endX-startX).toFixed(0)}px)`);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await sleep(100);

    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const x = startX + (endX - startX) * (i / steps);
      await page.mouse.move(x, startY, { steps: 1 });
      await sleep(20);
    }
    await page.mouse.up();
    await sleep(3000);
  } else if (captchaType === 'curve_drawing') {
    console.log('[6] 轨迹绘制验证码');
  }

  // 看响应
  const verifyResps = respLog.filter(r => r.url.includes('/check') || r.url.includes('/verify'));
  console.log('\n[7] verify 后响应:');
  for (const r of verifyResps.slice(-3)) {
    try {
      const j = JSON.parse(r.body);
      console.log(`  ${r.url.replace(/^https?:\/\/[^/]+/, '')}: tp=${j.tp} code=${j.code} vt=${j.vt ? 'YES' : 'null'}`);
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/63_after.png', fullPage: true });

  await browser.close();
})();
