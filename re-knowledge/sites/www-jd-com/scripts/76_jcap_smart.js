#!/usr/bin/env node
/**
 * 76_jcap_smart.js
 *
 * 智能处理 jcap 验证码：
 * - tp=3 (请按照图中轨迹绘制): 尝试检测 Z 形 → 失败则用硬编码 Z
 * - tp=11/25/26 (旋转/滑动): 暂时跳过
 * - 其他: 截图保存
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
  // 多次点击以触发验证码
  for (let click = 1; click <= 3; click++) {
    await page.click('.login-btn');
    await sleep(5000);
    const hasCaptcha = await page.evaluate(() => {
      return !!document.querySelector('#cpc_img, #curve_main_img, #main_img');
    });
    if (hasCaptcha) {
      console.log(`  点击 ${click} 次后触发验证码`);
      break;
    }
  }
  await sleep(5000);

  // 抓 cpc_img
  await page.waitForFunction(() => {
    const cpc = document.querySelector('#cpc_img');
    const curve = document.querySelector('#curve_main_img');
    if (cpc && cpc.src) return true;
    if (curve && curve.src) return true;
    return false;
  }, { timeout: 30000 }).catch(() => {});
  await sleep(1000);

  const captchaInfo = await page.evaluate(() => {
    const tip = document.querySelector('.tip_text.local_tip');
    const cpc = document.querySelector('#cpc_img');
    const curve = document.querySelector('#curve_main_img');
    const main = document.querySelector('#main_img');
    const getRect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: el.offsetWidth, h: el.offsetHeight, src: el.src };
    };
    return {
      tip: tip ? tip.innerText : null,
      cpcImg: getRect(cpc),
      curveImg: getRect(curve),
      mainImg: getRect(main),
    };
  });

  console.log('[4] 验证码信息:');
  console.log('  tip:', captchaInfo.tip);
  const img = captchaInfo.cpcImg || captchaInfo.curveImg;
  if (!img) {
    console.log('  ❌ 找不到验证码图');
    await page.screenshot({ path: '/tmp/jd_track/76_no_captcha.png', fullPage: true });
    await browser.close();
    return;
  }
  console.log('  rect:', JSON.stringify(img));

  // 保存图片
  const b64 = img.src.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync('/tmp/jd_track/76_captcha.jpg', Buffer.from(b64, 'base64'));
  console.log('  saved:', (b64.length * 3 / 4 / 1024).toFixed(1), 'KB');

  // 提取图片自然尺寸
  const naturalSize = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    const curve = document.querySelector('#curve_main_img');
    const el = cpc || curve;
    return el ? { w: el.naturalWidth || el.width, h: el.naturalHeight || el.height } : null;
  });
  console.log('  natural size:', JSON.stringify(naturalSize));

  // 用 scikit-image 检测 Z 路径
  console.log('[5] 检测 Z 路径');
  let traj;
  try {
    const out = execSync(
      `timeout 20 python3 /workspace/re-knowledge/sites/www-jd-com/scripts/75_detect_z_skim.py /tmp/jd_track/76_captcha.jpg`,
      { timeout: 25000, encoding: 'utf-8' }
    );
    const lines = out.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    traj = JSON.parse(jsonLine);
    console.log('  检测到:', traj.points ? traj.points.length : 0, '点');
    if (traj.points && traj.points.length >= 5) {
      console.log('  start:', traj.start, 'end:', traj.end);
    } else {
      console.log('  ❌ 检测点太少，使用硬编码 Z');
      traj = null;
    }
  } catch (e) {
    console.log('  ❌ 检测失败:', e.message);
    traj = null;
  }

  if (!traj) {
    // 用硬编码 Z
    console.log('[5b] 使用硬编码 Z 路径');
    const w = naturalSize ? naturalSize.w : 290;
    const h = naturalSize ? naturalSize.h : 179;
    const out = execSync(
      `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/77_gen_z_path.py ${w} ${h}`,
      { encoding: 'utf-8' }
    );
    traj = JSON.parse(out);
    console.log('  硬编码 Z:', traj.points.length, '点');
  }

  // 计算屏幕坐标
  const screenPoints = traj.points.map(p => ({
    x: img.x + (p.x / traj.width) * img.w,
    y: img.y + (p.y / traj.height) * img.h,
  }));

  console.log('[6] 模拟鼠标绘制');
  console.log('  起点:', JSON.stringify(screenPoints[0]));
  console.log('  终点:', JSON.stringify(screenPoints[screenPoints.length - 1]));

  // 多次点击尝试（如果一次失败，刷新后重试）
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`\n--- attempt ${attempt} ---`);
    if (attempt > 1) {
      // 点击刷新按钮
      try {
        await page.click('.refresh');
        await sleep(8000);
        // 重新获取 cpc_img
        const newImg = await page.evaluate(() => {
          const cpc = document.querySelector('#cpc_img');
          if (cpc && cpc.src) {
            const r = cpc.getBoundingClientRect();
            return { x: r.x, y: r.y, w: cpc.offsetWidth, h: cpc.offsetHeight, src: cpc.src };
          }
          return null;
        });
        if (newImg) {
          // 更新 img
          Object.assign(img, newImg);
        }
      } catch (e) {
        console.log('  refresh failed:', e.message);
      }
    }

    await page.mouse.move(screenPoints[0].x, screenPoints[0].y);
    await page.mouse.down();
    await sleep(80);

    for (let i = 1; i < screenPoints.length; i++) {
      await page.mouse.move(screenPoints[i].x, screenPoints[i].y, { steps: 1 });
      await sleep(15);
    }

    await page.mouse.up();
    await sleep(4000);

    // 检查响应
    const lastCheck = [...respLog].reverse().find(r => r.url.includes('/check'));
    if (lastCheck) {
      try {
        const j = JSON.parse(lastCheck.body);
        console.log(`  check tp=${j.tp} code=${j.code} vt=${j.vt ? 'YES' : 'null'}`);
        if (j.vt) {
          fs.writeFileSync('/tmp/jd_track/76_vt.txt', j.vt);
          console.log(`  ✅ vt saved!`);
          break;
        }
      } catch (e) {}
    }
  }

  await page.screenshot({ path: '/tmp/jd_track/76_after.png', fullPage: true });

  await browser.close();
})();
