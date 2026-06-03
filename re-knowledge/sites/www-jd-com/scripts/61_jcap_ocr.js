#!/usr/bin/env node
/**
 * 61_jcap_ocr.js
 *
 * 真实 headed Chrome 触发 jcap 验证码，用 Python OpenCV 检测轨迹，
 * 然后用 puppeteer 模拟鼠标沿轨迹绘制。
 *
 * 验证码类型：tp=26 "请按照图中轨迹绘制"
 * 曲线颜色：#ff3b30 / #34c759 / #0a84ff 或从背景挑选
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

  console.log('[2] 输入账号密码');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', 'jd_test_final' + Date.now().toString().slice(-6) + '@163.com', { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  console.log('[3] 点击登录触发验证码');
  await page.click('.login-btn');
  await sleep(8000);

  // 抓 cpc_img
  const cpcInfo = await page.evaluate(() => {
    const c = document.querySelector('#cpc_img');
    if (!c) return null;
    return {
      src: c.src,
      w: c.offsetWidth,
      h: c.offsetHeight,
      rect: c.getBoundingClientRect(),
      tip: (() => {
        const t = document.querySelector('.tip_text.local_tip');
        return t ? t.innerText : null;
      })(),
      dragDom: (() => {
        // 找 drag_dom
        const candidates = ['#cpc_img_container', '.drag-box', '#slider-div', '[class*=drag]'];
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

  if (!cpcInfo || !cpcInfo.src || cpcInfo.src.length < 200) {
    console.log('❌ cpc_img 未找到或 src 为空');
    console.log('cpcInfo:', JSON.stringify(cpcInfo));
    await page.screenshot({ path: '/tmp/jd_track/61_no_captcha.png', fullPage: true });
    await browser.close();
    return;
  }

  console.log('[4] 抓到验证码图片');
  console.log('  size:', cpcInfo.w, 'x', cpcInfo.h);
  console.log('  tip:', cpcInfo.tip);
  console.log('  dragDom:', JSON.stringify(cpcInfo.dragDom));

  // 保存 cpc_img 真实 jpg
  const b64 = cpcInfo.src.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync('/tmp/jd_track/61_cpc_full.jpg', Buffer.from(b64, 'base64'));
  console.log('  saved: /tmp/jd_track/61_cpc_full.jpg (', (b64.length * 3/4 / 1024).toFixed(1), 'KB)');

  // 保存 respLog
  fs.writeFileSync('/tmp/jd_track/61_resps.json', JSON.stringify(respLog, null, 2));
  console.log('  saved: /tmp/jd_track/61_resps.json (', respLog.length, 'responses)');

  // 看最近一次 check 响应里的 vt, s_code 等
  const lastCheck = [...respLog].reverse().find(r => r.url.includes('/check'));
  if (lastCheck) {
    try {
      const j = JSON.parse(lastCheck.body);
      console.log('  last check tp=', j.tp, ', code=', j.code, ', vt存在:', !!j.vt);
      console.log('  last check 关键字段:', Object.keys(j).join(','));
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/61_captcha_loaded.png', fullPage: true });

  // 调用 Python 脚本检测轨迹
  console.log('[5] 调用 Python OpenCV 检测轨迹');
  try {
    const trajJson = execSync(
      `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/61_detect_trajectory.py /tmp/jd_track/61_cpc_full.jpg`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    console.log('  Python 输出:', trajJson.slice(0, 500));
    const traj = JSON.parse(trajJson);
    if (traj.points && traj.points.length > 5) {
      console.log(`  轨迹点数: ${traj.points.length}, 颜色:`, traj.color);

      // 模拟鼠标沿轨迹绘制
      console.log('[6] 模拟鼠标沿轨迹绘制');
      // 注意：拖动 dom 是 cpc_img 容器
      const dragDom = cpcInfo.dragDom;
      if (!dragDom) {
        console.log('❌ 找不到 drag_dom');
        await browser.close();
        return;
      }

      // 计算相对拖动 dom 的坐标
      const startX = dragDom.x + 10;
      const startY = dragDom.y + 10;

      // 把轨迹点转换为屏幕坐标
      const points = traj.points.map(p => ({
        x: dragDom.x + (p.x / cpcInfo.w) * dragDom.w,
        y: dragDom.y + (p.y / cpcInfo.h) * dragDom.h,
      }));

      // mousedown
      await page.mouse.move(points[0].x, points[0].y);
      await page.mouse.down();
      await sleep(100);

      // 沿轨迹 mousemove
      for (let i = 1; i < points.length; i++) {
        await page.mouse.move(points[i].x, points[i].y, { steps: 1 });
        await sleep(8);
      }

      // mouseup
      await page.mouse.up();
      await sleep(3000);

      // 看响应
      const afterVerify = respLog.filter(r => r.url.includes('/check') || r.url.includes('/verify'));
      console.log('[7] verify 后的响应:');
      for (const r of afterVerify.slice(-3)) {
        try {
          const j = JSON.parse(r.body);
          console.log(`  ${r.url.slice(-50)}: tp=${j.tp} code=${j.code} vt=${j.vt ? j.vt.slice(0,20)+'...' : 'null'}`);
        } catch (e) {}
      }

      await page.screenshot({ path: '/tmp/jd_track/61_after_drag.png', fullPage: true });
    } else {
      console.log('❌ 未能检测到轨迹');
    }
  } catch (e) {
    console.log('❌ Python 调用失败:', e.message);
  }

  await browser.close();
})();
