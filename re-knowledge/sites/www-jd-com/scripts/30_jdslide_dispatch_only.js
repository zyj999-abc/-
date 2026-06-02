/**
 * 阶段 5 (修订4): dispatch mousedown 到 slideBtn + 真实 mouse move/up
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const USERNAME = `jdtest${randomStr(6)}@163.com`;

(async () => {
  console.log(`[配置] USERNAME: ${USERNAME}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
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

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 passport.jd.com ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:100px;left:200px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

  console.log('\n[2] 调 initJdSlide...');
  await page.evaluate(async () => {
    return new Promise((resolve) => {
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
        console.log('  [callback]', JSON.stringify(slideData).slice(0, 500));
        window.__slideData = slideData;
        resolve();
      });
      setTimeout(resolve, 30000);
    });
  });

  await new Promise(r => setTimeout(r, 4000));

  // 关键策略: dispatch mousedown 到 slideBtn 元素 + page.mouse 做真实 move
  // 这是 jdSlide 期待的: btn 收到 mousedown (内部 push mousePos) -> document 收到 mousemove (push) -> mouseup (push + submit)
  const dragResult = await page.evaluate(async () => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const bg = btn.parentElement;
    if (!btn) return { err: 'no btn' };

    const bgR = bg.getBoundingClientRect();
    const btnR = btn.getBoundingClientRect();

    // 起点: btn 中心 (但 h=0) 强制使用 bg 中心 y
    const startX = btnR.x + 25;  // btn 起始 x + 25 (假设 50px 按钮)
    const startY = bgR.y + bgR.height / 2;
    const endX = bgR.x + 250;  // 滑到中间

    // 派发真实 MouseEvent (bubble + cancelable)
    const fireEvt = (target, type, x, y) => {
      const e = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: type === 'mouseup' ? 0 : 1,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
      });
      target.dispatchEvent(e);
    };

    // 1. mousedown on slideBtn
    fireEvt(btn, 'mousedown', startX, startY);
    // 等下 jdSlide 内部 push + 设置 onmousemove
    await new Promise(r => setTimeout(r, 100));

    // 2. mousemove on document (30 步)
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = 1 - Math.pow(1 - t, 2);
      const x = startX + (endX - startX) * ease;
      const y = startY + Math.sin(t * Math.PI * 2) * 1.2;
      fireEvt(document, 'mousemove', x, y);
      await new Promise(r => setTimeout(r, 30));
    }

    // 3. mouseup on document
    await new Promise(r => setTimeout(r, 200));
    fireEvt(document, 'mouseup', endX, startY);

    return {
      ok: true,
      startX, startY, endX,
      bgR: { x: bgR.x, y: bgR.y, w: bgR.width, h: bgR.height },
      btnR: { x: btnR.x, y: btnR.y, w: btnR.width, h: btnR.height },
    };
  });
  console.log('\n[3] drag:', JSON.stringify(dragResult));

  await new Promise(r => setTimeout(r, 10000));
  await page.screenshot({ path: '/tmp/jd_track/slide_drag_real3.png', fullPage: true });

  const sResps = respLog.filter(r => r.url.includes('s.html'));
  const gResps = respLog.filter(r => r.url.includes('g.html'));
  console.log(`\n[4] g.html 响应 (${gResps.length} 条)`);
  console.log(`[5] s.html 响应 (${sResps.length} 条):`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 500)}`);
    console.log(`    body: ${r.body.slice(0, 2000)}`);
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

  fs.writeFileSync('/tmp/jd_track/drag7_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
