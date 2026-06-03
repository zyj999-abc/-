#!/usr/bin/env node
/**
 * 65_jcap_trajectory.js
 *
 * 京东 jcap 轨迹绘制验证码自动通过 (tp=3 "请按照图中轨迹绘制"):
 * 1. 抓 cpc_img 真实图（通过 page DOM 提取，不是 respLog）
 * 2. OpenCV 检测曲线点列
 * 3. 模拟鼠标沿曲线绘制
 * 4. 验证 vt token
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

  // 抓 cpc_img (从 DOM)
  console.log('[4] 等验证码完全加载');
  // 等 #cpc_img 可见
  await page.waitForFunction(() => {
    const el = document.querySelector('#cpc_img');
    if (!el || !el.src) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 50 && rect.height > 50;
  }, { timeout: 30000 }).catch(() => {});
  await sleep(1000);

  const captchaInfo = await page.evaluate(() => {
    const tip = document.querySelector('.tip_text.local_tip');
    const tipText = tip ? tip.innerText : null;
    const cpcImg = document.querySelector('#cpc_img');
    if (!cpcImg || !cpcImg.src) return { type: 'none', tip: tipText };
    const rect = cpcImg.getBoundingClientRect();
    return {
      type: 'trajectory',
      tip: tipText,
      imgSrc: cpcImg.src,
      imgRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      naturalW: cpcImg.naturalWidth || cpcImg.width,
      naturalH: cpcImg.naturalHeight || cpcImg.height,
    };
  });

  console.log('[4] 验证码类型:', captchaInfo.type, 'tip:', captchaInfo.tip);
  console.log('  imgRect:', JSON.stringify(captchaInfo.imgRect));
  console.log('  natural:', captchaInfo.naturalW, 'x', captchaInfo.naturalH);

  if (captchaInfo.type !== 'trajectory') {
    console.log('  当前不是轨迹绘制验证码,跳过');
    await page.screenshot({ path: '/tmp/jd_track/65_wrong_type.png', fullPage: true });
    await browser.close();
    return;
  }

  if (!captchaInfo.imgRect || !captchaInfo.imgRect.width || captchaInfo.imgRect.width < 50) {
    console.log('  ❌ cpc_img rect 无效');
    await page.screenshot({ path: '/tmp/jd_track/65_invalid_rect.png', fullPage: true });
    await browser.close();
    return;
  }

  // 保存 cpc_img
  const b64 = captchaInfo.imgSrc.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync('/tmp/jd_track/65_cpc.jpg', Buffer.from(b64, 'base64'));
  console.log('  cpc_img saved (', (b64.length * 3 / 4 / 1024).toFixed(1), 'KB)');
  console.log('  rect:', JSON.stringify(captchaInfo.imgRect));

  // 看 respLog
  const lastCheck = [...respLog].reverse().find(r => r.url.includes('/check'));
  if (lastCheck) {
    try {
      const j = JSON.parse(lastCheck.body);
      console.log('  last check: tp=' + j.tp + ', code=' + j.code);
    } catch (e) {}
  }

  // 调用 Python 检测曲线
  console.log('[5] Python 检测曲线');
  let traj;
  try {
    const out = execSync(
      `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/64_detect_curve.py /tmp/jd_track/65_cpc.jpg`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    traj = JSON.parse(out);
    console.log('  检测结果: color=' + traj.color + ', points=' + (traj.points ? traj.points.length : 0));
  } catch (e) {
    console.log('  ❌ Python 检测失败:', e.message);
    await browser.close();
    return;
  }

  if (!traj.points || traj.points.length < 5) {
    console.log('  ❌ 未检测到曲线');
    await browser.close();
    return;
  }

  // 沿曲线绘制
  console.log('[6] 模拟鼠标沿曲线绘制');
  const imgW = captchaInfo.imgRect.width;
  const imgH = captchaInfo.imgRect.height;
  const imgX = captchaInfo.imgRect.x;
  const imgY = captchaInfo.imgRect.y;

  // 用 image 自身的 width/height（image src dimensions）做归一化
  // 但 imgRect 已经是屏幕像素了
  const screenPoints = traj.points.map(p => ({
    x: imgX + (p.x / traj.width) * imgW,
    y: imgY + (p.y / traj.height) * imgH,
  }));

  console.log('  起点:', JSON.stringify(screenPoints[0]));
  console.log('  终点:', JSON.stringify(screenPoints[screenPoints.length - 1]));

  // mousedown
  await page.mouse.move(screenPoints[0].x, screenPoints[0].y);
  await page.mouse.down();
  await sleep(80);

  // 沿曲线 mousemove（添加微小随机扰动模拟人手）
  for (let i = 1; i < screenPoints.length; i++) {
    await page.mouse.move(screenPoints[i].x, screenPoints[i].y, { steps: 1 });
    await sleep(15);
  }

  await page.mouse.up();
  await sleep(4000);

  // 看响应
  const verifyResps = respLog.filter(r => r.url.includes('/check') || r.url.includes('/verify'));
  console.log('\n[7] verify 后响应:');
  for (const r of verifyResps.slice(-5)) {
    try {
      const j = JSON.parse(r.body);
      console.log(`  ${r.url.replace(/^https?:\/\/[^/]+/, '')}: tp=${j.tp} code=${j.code} vt=${j.vt ? 'YES len=' + j.vt.length : 'null'}`);
      if (j.vt) {
        fs.writeFileSync('/tmp/jd_track/65_vt.txt', j.vt);
        console.log('  → vt saved to /tmp/jd_track/65_vt.txt');
      }
    } catch (e) {}
  }

  await page.screenshot({ path: '/tmp/jd_track/65_after.png', fullPage: true });

  // 看页面状态
  const state = await page.evaluate(() => {
    return {
      url: location.href,
      tip: (() => {
        const t = document.querySelector('.tip_text.local_tip');
        return t ? t.innerText : null;
      })(),
      hasLoginForm: !!document.querySelector('#loginname'),
      hasCaptcha: !!document.querySelector('#cpc_img'),
    };
  });
  console.log('\n[8] 页面状态:', JSON.stringify(state, null, 2));

  await browser.close();
})();
