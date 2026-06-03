#!/usr/bin/env node
/**
 * 89_jcap_z_draw.js
 *
 * 完整流程：
 * 1. 打开 passport.jd.com
 * 2. 用真实 mouse 行为输入账号密码
 * 3. 多次点击 .login-btn 触发 jcap
 * 4. 抓取 cpc_img base64
 * 5. 调用 88_gen_z_path.py 生成 Z 路径
 * 6. 用 puppeteer mouse 模拟慢速 Z 绘制
 * 7. 等待 /check 响应
 * 8. 拿 vt token
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const VENV_SITE = '/workspace/re-knowledge/sites/www-jd-com';
const GEN_SCRIPT = path.join(VENV_SITE, 'scripts/88_gen_z_path.py');
const TRACK_DIR = '/tmp/jd_track';

async function humanType(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
  }
}

async function humanClick(page, selector) {
  const el = await page.$(selector);
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  const x = box.x + 10 + Math.random() * Math.max(0, box.width - 20);
  const y = box.y + 5 + Math.random() * Math.max(0, box.height - 10);
  await page.mouse.move(x, y, { steps: 5 + Math.random() * 5 });
  await sleep(150 + Math.random() * 200);
  await page.mouse.click(x, y);
  return true;
}

async function humanInput(page, selector, text) {
  const el = await page.$(selector);
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  const x = box.x + 30;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 5 });
  await sleep(100);
  await page.mouse.click(x, y, { clickCount: 3 });
  await sleep(100);
  await humanType(page, text);
  return true;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1366,768',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('jcap') || url.includes('/check') || url.includes('/verify')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开登录页');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  const ts = Date.now().toString().slice(-8);
  const email = `jdtest_${ts}@163.com`;
  console.log(`[2] 输入账号: ${email}`);
  await humanInput(page, '#loginname', email);
  await sleep(500);
  await humanInput(page, '#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  console.log('[3] 点击登录触发验证码');
  let triggered = false;
  for (let click = 1; click <= 4; click++) {
    const ok = await humanClick(page, '.login-btn');
    if (!ok) {
      console.log('  .login-btn 找不到');
      break;
    }
    for (let w = 0; w < 8; w++) {
      await sleep(2500);
      const has = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
      if (has) {
        console.log(`  触发 (点击 ${click} 次, ${(w+1)*2.5}s)`);
        triggered = true;
        break;
      }
    }
    if (triggered) break;
    console.log(`  click ${click} 未触发，等 5s 后重试`);
    await sleep(5000);
  }
  if (!triggered) {
    console.log('  ❌ 验证码未触发');
    await page.screenshot({ path: `${TRACK_DIR}/89_no_captcha.png`, fullPage: true });
    await browser.close();
    return;
  }
  await sleep(2000);

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
    await page.screenshot({ path: `${TRACK_DIR}/89_no_img.png`, fullPage: true });
    await browser.close();
    return;
  }
  console.log(`[4] cpc_img: ${imgInfo.w}x${imgInfo.h}, rect=(${imgInfo.x.toFixed(0)},${imgInfo.y.toFixed(0)},${imgInfo.dw}x${imgInfo.dh})`);

  const b64 = imgInfo.src.replace(/^data:image\/\w+;base64,/, '');
  const captchaPath = `${TRACK_DIR}/89_captcha.jpg`;
  fs.writeFileSync(captchaPath, Buffer.from(b64, 'base64'));

  // 生成 Z 路径
  console.log('[5] 生成 Z 路径');
  let traj;
  try {
    const out = execSync(
      `timeout 20 python3 ${GEN_SCRIPT} ${captchaPath}`,
      { timeout: 25000, encoding: 'utf-8' }
    );
    traj = JSON.parse(out.trim());
    if (traj.error) {
      console.log('  ❌ 错误:', traj.error);
      await browser.close();
      return;
    }
    console.log(`  ${traj.points.length} 点`);
    console.log(`  corners: TL=${traj.top_left} TR=${traj.top_right} BL=${traj.bot_left} BR=${traj.bot_right}`);
  } catch (e) {
    console.log('  ❌ 异常:', e.message);
    await browser.close();
    return;
  }

  // 屏幕坐标
  const scaleX = imgInfo.dw / imgInfo.w;
  const scaleY = imgInfo.dh / imgInfo.h;
  const screenPoints = traj.points.map(p => ({
    x: imgInfo.x + p.x * scaleX,
    y: imgInfo.y + p.y * scaleY,
  }));

  console.log(`[6] 模拟 mouse 绘制 (${screenPoints.length} 点)`);

  // 1. 先 hover 到起点
  await page.mouse.move(screenPoints[0].x, screenPoints[0].y, { steps: 10 });
  await sleep(200);

  // 2. mousedown
  await page.mouse.move(screenPoints[0].x, screenPoints[0].y);
  await sleep(120);
  await page.mouse.down();
  await sleep(80);

  // 3. 慢速移动
  for (let i = 1; i < screenPoints.length; i++) {
    const p = screenPoints[i];
    const prev = screenPoints[i - 1];
    const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
    const steps = Math.max(1, Math.min(5, Math.ceil(dist / 5)));
    await page.mouse.move(p.x, p.y, { steps });
    await sleep(25 + Math.random() * 25);
  }
  await sleep(180);
  await page.mouse.up();
  console.log('  mouseup done');
  await sleep(8000);

  // 看响应
  console.log('[7] 检查 /check 响应');
  const checks = respLog.filter(r => r.url.includes('/check') || r.url.includes('/verify'));
  for (const c of checks) {
    try {
      const j = JSON.parse(c.body);
      console.log(`  ${c.url.split('/').pop()}: tp=${j.tp} code=${j.code} vt=${j.vt ? 'YES' : 'null'} msg=${j.message || ''}`);
      if (j.vt) {
        fs.writeFileSync(`${TRACK_DIR}/89_vt.txt`, j.vt);
        console.log(`  ✅ vt saved!`);
      }
    } catch (e) {
      console.log(`  raw: ${c.body.substring(0, 200)}`);
    }
  }

  await page.screenshot({ path: `${TRACK_DIR}/89_after.png`, fullPage: true });
  await browser.close();
})();
