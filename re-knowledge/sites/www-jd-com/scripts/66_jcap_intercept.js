#!/usr/bin/env node
/**
 * 66_jcap_intercept.js
 *
 * 拦截 jcap verify 请求，查看真实发送的数据结构。
 * 1. 触发验证码
 * 2. Hook XHR/fetch，捕获 verify 请求 body
 * 3. 模拟鼠标绘制（用真实数据格式）
 * 4. 拿 vt token
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

  const capturedRequests = [];
  const capturedResponses = [];

  // 拦截 XHR
  await page.evaluateOnNewDocument(() => {
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      if (this._url && this._url.includes('jcap')) {
        console.log('[XHR_SEND]', this._url, 'body=', body ? body.substring(0, 500) : null);
        window.__capturedXHR = window.__capturedXHR || [];
        window.__capturedXHR.push({
          url: this._url,
          method: this._method || 'POST',
          body: body ? body.substring(0, 5000) : null,
          time: Date.now(),
        });
      }
      return origSend.apply(this, arguments);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      this._method = method;
      return origOpen.apply(this, arguments);
    };
  });

  page.on('console', msg => {
    const t = msg.text();
    if (t.startsWith('[XHR_SEND]') || t.startsWith('[CAPTCHA]')) {
      console.log('PAGE:', t);
    }
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('jcap') && url.includes('/api/')) {
      try {
        const txt = await resp.text();
        capturedResponses.push({ url, body: txt });
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

  // 等验证码
  await page.waitForFunction(() => {
    const cpc = document.querySelector('#cpc_img');
    const curve = document.querySelector('#curve_main_img');
    if (cpc && cpc.src) return true;
    if (curve && curve.src) return true;
    return false;
  }, { timeout: 30000 }).catch(() => {});
  await sleep(1000);

  // 检查 captcha 类型
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
  console.log('  cpcImg:', captchaInfo.cpcImg ? 'YES' : 'NO');
  console.log('  curveImg:', captchaInfo.curveImg ? 'YES' : 'NO');
  console.log('  mainImg:', captchaInfo.mainImg ? 'YES' : 'NO');

  // 选 captcha 类型
  let img = captchaInfo.cpcImg || captchaInfo.curveImg;
  if (!img) {
    console.log('❌ 没有找到验证码图');
    await page.screenshot({ path: '/tmp/jd_track/66_no_captcha.png', fullPage: true });
    await browser.close();
    return;
  }

  console.log('  rect:', JSON.stringify(img));
  console.log('  src length:', img.src.length);

  // 保存 b1
  const b64 = img.src.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync('/tmp/jd_track/66_captcha.jpg', Buffer.from(b64, 'base64'));
  console.log('  saved (', (b64.length * 3 / 4 / 1024).toFixed(1), 'KB)');

  // 用 Python 检测曲线
  console.log('[5] Python 检测曲线');
  let traj;
  try {
    const out = execSync(
      `python3 /workspace/re-knowledge/sites/www-jd-com/scripts/64_detect_curve.py /tmp/jd_track/66_captcha.jpg`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    traj = JSON.parse(out);
    console.log('  color:', traj.color, 'points:', traj.points ? traj.points.length : 0);
  } catch (e) {
    console.log('  ❌ 检测失败:', e.message);
    await browser.close();
    return;
  }

  if (!traj.points || traj.points.length < 5) {
    console.log('  ❌ 未检测到曲线');
    await browser.close();
    return;
  }

  // 计算屏幕坐标
  const screenPoints = traj.points.map(p => ({
    x: img.x + (p.x / traj.width) * img.w,
    y: img.y + (p.y / traj.height) * img.h,
  }));

  console.log('  起点:', JSON.stringify(screenPoints[0]));
  console.log('  终点:', JSON.stringify(screenPoints[screenPoints.length - 1]));

  // mousedown
  await page.mouse.move(screenPoints[0].x, screenPoints[0].y);
  await page.mouse.down();
  await sleep(120);

  // 沿轨迹 mousemove - 慢速
  for (let i = 1; i < screenPoints.length; i++) {
    const p = screenPoints[i];
    await page.mouse.move(p.x, p.y, { steps: 1 });
    await sleep(20);
  }

  // 鼠标在终点停一会
  await sleep(150);
  await page.mouse.up();
  await sleep(5000);

  // 看拦截的 XHR
  const captured = await page.evaluate(() => window.__capturedXHR || []);
  console.log('\n[6] 拦截的 XHR 请求:');
  for (const r of captured) {
    console.log(`  ${r.url}`);
    console.log(`  body: ${r.body ? r.body.substring(0, 800) : 'null'}`);
    console.log('---');
  }

  // 看响应
  console.log('\n[7] jcap 响应:');
  for (const r of capturedResponses.slice(-5)) {
    try {
      const j = JSON.parse(r.body);
      console.log(`  ${r.url.replace(/^https?:\/\/[^/]+/, '')}: tp=${j.tp} code=${j.code} vt=${j.vt ? 'YES' : 'null'}`);
    } catch (e) {}
  }

  // 保存完整 XHR 数据
  fs.writeFileSync('/tmp/jd_track/66_xhr.json', JSON.stringify(captured, null, 2));

  await page.screenshot({ path: '/tmp/jd_track/66_after.png', fullPage: true });

  await browser.close();
})();
