/**
 * 阶段 6 (修订5): 用 jdSlide 强制走完, 设置 inline style + dispatch mousedown
 *
 * 关键: 在 initJdSlide 之前, 给 jdSlide 容器预注入 slide-btn override CSS
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { getCoordinate } = require('./jdSlide_d');

const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

(async () => {
  const USERNAME = `jdtest${randomStr(6)}@163.com`;
  console.log(`[配置] USERNAME: ${USERNAME}`);

  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  // 注入 override CSS: 让 slide-btn 默认可见
  await page.evaluateOnNewDocument(() => {
    const style = document.createElement('style');
    style.textContent = `
      .JDJRV-slide-btn { display: block !important; width: 55px !important; height: 55px !important; }
      .JDJRV-slide-btn .JDJRV-slide-icon { display: block !important; }
    `;
    document.head.appendChild(style);
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 login page...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 创建 jdSlide 容器
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:50px;left:200px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

  console.log('\n[2] 调 initJdSlide + 等 jdSlide 完整初始化...');
  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      let slideInstance = null;
      const config = {
        id: 'jd_slide_container',
        protocol: 'https',
        lang: 'zh-CN',
        product: 'embed',
        scene: 'login_pc',
        appId: '1604ebb2287',
        width: 360,
        account: 'jd_test_user_12345',
      };
      initJdSlide(config, function(slideData) {
        window.__slideData = slideData;
        resolve({ ok: true });
      });
      setTimeout(() => resolve({ ok: false, err: 'timeout' }), 30000);
    });
  });
  console.log('  init result:', JSON.stringify(result));

  await new Promise(r => setTimeout(r, 5000));

  // 检查 slide-btn 状态
  const info = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (!btn) return { err: 'no btn' };
    const r = btn.getBoundingClientRect();
    const cs = window.getComputedStyle(btn);
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      display: cs.display,
      inlineStyle: btn.getAttribute('style') || '',
    };
  });
  console.log('\n[3] slide-btn:', JSON.stringify(info, null, 2));

  if (!info.rect || info.rect.h < 5) {
    console.log('  按钮 h=0, 强制设置...');
    await page.evaluate(() => {
      const btn = document.querySelector('.JDJRV-slide-btn');
      if (btn) {
        // 强制设置 inline style
        btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
      }
    });
    await new Promise(r => setTimeout(r, 500));
  }

  // 真实 mouse 拖动 + dispatch mousedown
  console.log('\n[4] 拖动滑块...');
  const dragRes = await page.evaluate(async () => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const bg = btn.parentElement;
    const r = btn.getBoundingClientRect();
    const bgR = bg.getBoundingClientRect();

    const startX = r.x + r.width / 2;
    const startY = bgR.y + bgR.height / 2;  // bg 中心 y
    const endX = bgR.x + 250;
    return { startX, startY, endX, rW: r.width, rH: r.height, bgR: { x: bgR.x, y: bgR.y, w: bgR.width, h: bgR.height } };
  });
  console.log('  drag setup:', JSON.stringify(dragRes));

  // 真实 page.mouse
  await page.mouse.move(dragRes.startX, dragRes.startY);
  await new Promise(r => setTimeout(r, 200));
  // 先 dispatch mousedown 触发 jdSlide 内部
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, dragRes.startX, dragRes.startY);
  await new Promise(r => setTimeout(r, 100));
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 200));

  // 真实 move
  for (let i = 1; i <= 50; i++) {
    const t = i / 50;
    const ease = 1 - Math.pow(1 - t, 2);
    const x = dragRes.startX + (dragRes.endX - dragRes.startX) * ease;
    const y = dragRes.startY + Math.sin(t * Math.PI * 2.5) * 1.2;
    await page.mouse.move(x, y, { steps: 1 });
    await new Promise(r => setTimeout(r, 20 + Math.random() * 20));
  }
  await new Promise(r => setTimeout(r, 500));
  await page.mouse.up();
  console.log('  拖动完成');

  await new Promise(r => setTimeout(r, 12000));
  await page.screenshot({ path: '/tmp/jd_track/phase6_v5.png', fullPage: true });

  // 看响应
  const sResps = respLog.filter(r => r.url.includes('s.html'));
  const gResps = respLog.filter(r => r.url.includes('g.html'));
  console.log(`\n[5] g.html: ${gResps.length}, s.html: ${sResps.length}`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 400)}`);
    console.log(`    body: ${r.body.slice(0, 1500)}`);
  }

  const cb = await page.evaluate(() => {
    const data = window.__slideData;
    if (!data) return null;
    const out = {};
    try { out.success = data.getSuccess ? data.getSuccess() : null; } catch (e) {}
    try { out.message = data.getMessage ? data.getMessage() : null; } catch (e) {}
    try { out.validate = data.getValidate ? data.getValidate() : null; } catch (e) {}
    return out;
  });
  console.log('\n[6] callback:');
  console.log(JSON.stringify(cb, null, 2));

  fs.writeFileSync('/tmp/jd_track/phase6_v5_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
