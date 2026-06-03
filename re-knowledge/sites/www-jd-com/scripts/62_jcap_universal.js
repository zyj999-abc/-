#!/usr/bin/env node
/**
 * 62_jcap_universal.js
 *
 * 通用 jcap 验证码自动处理：
 * - tp=26 (请按照图中轨迹绘制): OpenCV 检测曲线 → 鼠标沿曲线绘制
 * - tp=3/图片 (请拖动滑块使图片为正/旋转): 检测图片角度 → 拖动旋转
 *
 * 真实 headed Chrome + xvfb
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
  console.log('[2] 输入账号密码 (ts=' + ts + ')');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', `jd_test_${ts}@163.com`, { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  console.log('[3] 点击登录触发验证码');
  await page.click('.login-btn');
  await sleep(10000);

  // 抓验证码信息 - 支持两种 captcha 类型
  const captchaInfo = await page.evaluate(() => {
    const tip = document.querySelector('.tip_text.local_tip');
    const tipText = tip ? tip.innerText : null;

    // tp=26 轨迹绘制
    const cpcImg = document.querySelector('#cpc_img');
    if (cpcImg && cpcImg.src && cpcImg.src.startsWith('data:')) {
      return {
        type: 'trajectory',
        tip: tipText,
        imgSrc: cpcImg.src,
        imgW: cpcImg.offsetWidth,
        imgH: cpcImg.offsetHeight,
        imgRect: cpcImg.getBoundingClientRect(),
      };
    }

    // 旋转滑块
    const dragDom = document.querySelector('.drag-dom');
    const dragBox = document.querySelector('.drag-box, [ref="drag_box"]') || document.querySelector('#main_img');
    const cubeFaces = document.querySelectorAll('[class*=img_dom]');
    let bgImg = null;
    for (const f of cubeFaces) {
      const bg = f.style.background || getComputedStyle(f).background;
      if (bg && bg.includes('data:image')) {
        bgImg = bg;
        break;
      }
    }
    if (dragBox || dragDom) {
      return {
        type: 'rotate_slider',
        tip: tipText,
        dragBox: dragBox ? dragBox.getBoundingClientRect() : null,
        dragDomRect: dragDom ? dragDom.getBoundingClientRect() : null,
        dragDomTransform: dragDom ? getComputedStyle(dragDom).transform : null,
        bgImg,
      };
    }

    return { type: 'unknown', tip: tipText };
  });

  console.log('[4] 验证码类型:', captchaInfo.type);
  console.log('  tip:', captchaInfo.tip);
  console.log('  关键字段:', Object.keys(captchaInfo).filter(k => k !== 'type' && k !== 'tip').join(', '));

  // 保存 respLog
  fs.writeFileSync('/tmp/jd_track/62_resps.json', JSON.stringify(respLog, null, 2));
  console.log('  respLog saved, ' + respLog.length + ' entries');

  // 看最近 check 响应
  const lastCheck = [...respLog].reverse().find(r => r.url.includes('/check'));
  if (lastCheck) {
    try {
      const j = JSON.parse(lastCheck.body);
      console.log('  last check: tp=' + j.tp + ', code=' + j.code + ', vt=' + (j.vt ? j.vt.slice(0, 30) + '...' : 'null'));
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/62_loaded.png', fullPage: true });

  if (captchaInfo.type === 'trajectory') {
    // 轨迹绘制验证码
    const b64 = captchaInfo.imgSrc.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jd_track/62_cpc.jpg', Buffer.from(b64, 'base64'));
    console.log('[5] 抓到 cpc_img:', (b64.length * 3 / 4 / 1024).toFixed(1), 'KB,', captchaInfo.imgW, 'x', captchaInfo.imgH);

    // 检测曲线
    let traj;
    try {
      const trajJson = execSync(
        `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/61_detect_trajectory.py /tmp/jd_track/62_cpc.jpg`,
        { timeout: 30000, encoding: 'utf-8' }
      );
      traj = JSON.parse(trajJson);
      console.log('  轨迹检测: color=' + traj.color + ', points=' + (traj.points ? traj.points.length : 0));
    } catch (e) {
      console.log('❌ Python 轨迹检测失败:', e.message);
      await browser.close();
      return;
    }

    if (!traj.points || traj.points.length < 5) {
      console.log('❌ 未能检测到曲线');
      await browser.close();
      return;
    }

    // 沿轨迹绘制
    console.log('[6] 模拟鼠标沿轨迹绘制');
    const startPoint = traj.points[0];
    const startX = captchaInfo.imgRect.x + (startPoint.x / captchaInfo.imgW) * captchaInfo.imgRect.width;
    const startY = captchaInfo.imgRect.y + (startPoint.y / captchaInfo.imgH) * captchaInfo.imgRect.height;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await sleep(100);

    for (let i = 1; i < traj.points.length; i++) {
      const p = traj.points[i];
      const x = captchaInfo.imgRect.x + (p.x / captchaInfo.imgW) * captchaInfo.imgRect.width;
      const y = captchaInfo.imgRect.y + (p.y / captchaInfo.imgH) * captchaInfo.imgRect.height;
      await page.mouse.move(x, y, { steps: 1 });
      await sleep(10);
    }
    await page.mouse.up();
    await sleep(3000);
  } else if (captchaInfo.type === 'rotate_slider') {
    // 旋转滑块验证码
    console.log('[5] 旋转滑块验证码');
    console.log('  dragBox:', JSON.stringify(captchaInfo.dragBox));
    console.log('  dragDom transform:', captchaInfo.dragDomTransform);

    if (!captchaInfo.dragBox) {
      console.log('❌ 找不到 dragBox');
      await browser.close();
      return;
    }

    // 解析当前 rotationX 角度
    let currentAngle = 0;
    if (captchaInfo.dragDomTransform) {
      const m = captchaInfo.dragDomTransform.match(/rotateX\(([-\d.]+)deg\)/);
      if (m) currentAngle = parseFloat(m[1]);
    }
    console.log('  当前 rotationX:', currentAngle, '度');

    // 目标: 旋转到 0 度
    const targetAngle = 0;
    const deltaAngle = targetAngle - currentAngle;
    console.log('  需要旋转:', deltaAngle, '度');

    // 这里需要先实现角度检测 - 估算需要拖动多少 px
    // 通过尝试 + 反馈来拖动
    const dragBoxRect = captchaInfo.dragBox;
    const centerY = dragBoxRect.y + dragBoxRect.height / 2;

    // 先往右拖到 max (rotateX = 0)
    // 看 dragDom 区域，可以拖动的水平范围
    // drag_dom 在 drag_box 内部，可能有最大拖动范围

    // 简单策略：先尝试拖动到右端 200px，看效果
    // 然后根据 verify 响应调整
    const startX = dragBoxRect.x + dragBoxRect.width / 2;
    const endX = dragBoxRect.x + dragBoxRect.width - 20;

    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await sleep(50);

    // 慢速拖动
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      const x = startX + (endX - startX) * (i / steps);
      await page.mouse.move(x, centerY, { steps: 1 });
      await sleep(20);
    }
    await page.mouse.up();
    await sleep(3000);
  } else {
    console.log('❓ 未知验证码类型');
  }

  // 看响应
  const verifyResps = respLog.filter(r => r.url.includes('/check') || r.url.includes('/verify'));
  console.log('\n[7] verify 后响应:');
  for (const r of verifyResps.slice(-5)) {
    try {
      const j = JSON.parse(r.body);
      console.log(`  ${r.url.replace(/^https?:\/\/[^/]+/, '').padEnd(40)}: tp=${j.tp} code=${j.code} vt=${j.vt ? j.vt.slice(0,30) + '...' : 'null'} s_code=${j.s_code}`);
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/62_after.png', fullPage: true });

  // 看页面状态
  const state = await page.evaluate(() => {
    return {
      url: location.href,
      hasCaptcha: !!document.querySelector('#cpc_img, .drag-dom'),
      tip: (() => {
        const t = document.querySelector('.tip_text.local_tip');
        return t ? t.innerText : null;
      })(),
    };
  });
  console.log('\n[8] 页面状态:', JSON.stringify(state, null, 2));

  await browser.close();
})();
