/**
 * 阶段 8: 用真实 Chrome 让 jdSlide 走完流程, 看 s.html 真实响应
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

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

  console.log('[1] 打开 login...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:50px;left:200px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

  console.log('\n[2] initJdSlide...');
  await page.evaluate(async () => {
    return new Promise((resolve) => {
      initJdSlide({
        id: 'jd_slide_container',
        protocol: 'https',
        lang: 'zh-CN',
        product: 'embed',
        scene: 'login_pc',
        appId: '1604ebb2287',
        width: 360,
        account: 'jd_test_user_12345',
      }, (d) => { window.__slideData = d; resolve(); });
      setTimeout(resolve, 30000);
    });
  });
  await new Promise(r => setTimeout(r, 5000));

  // 强制 btn 显示
  await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (btn) btn.style.cssText = 'position:absolute;left:0;top:0;width:55px;height:55px;display:block;background:red;cursor:pointer;z-index:99999;';
  });
  await new Promise(r => setTimeout(r, 500));

  // 真实拖动
  console.log('\n[3] 真实拖动...');
  const setup = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const bg = btn.parentElement;
    const r = btn.getBoundingClientRect();
    const bgR = bg.getBoundingClientRect();
    return { startX: r.x + r.width/2, startY: bgR.y + bgR.height/2, endX: bgR.x + 240 };
  });

  await page.mouse.move(setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate((x, y) => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  }, setup.startX, setup.startY);
  await new Promise(r => setTimeout(r, 100));
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 200));

  for (let i = 1; i <= 55; i++) {
    const t = i / 55;
    const ease = 1 - Math.pow(1 - t, 2.5);
    const x = setup.startX + (setup.endX - setup.startX) * ease;
    const y = setup.startY + Math.sin(t * Math.PI * 2.5) * 1.2;
    await page.mouse.move(x, y, { steps: 1 });
    await new Promise(r => setTimeout(r, 20 + Math.random() * 25));
  }
  await new Promise(r => setTimeout(r, 500));
  await page.mouse.up();
  console.log('  完成');

  await new Promise(r => setTimeout(r, 15000));
  await page.screenshot({ path: '/tmp/jd_track/phase8.png', fullPage: true });

  // s.html 响应
  const sResps = respLog.filter(r => r.url.includes('s.html'));
  const gResps = respLog.filter(r => r.url.includes('g.html'));
  console.log(`\n[4] g.html: ${gResps.length}, s.html: ${sResps.length}`);
  for (const r of gResps) {
    console.log(`  g.html [${r.status}]: ${r.body.slice(0, 200)}`);
  }
  for (const r of sResps) {
    console.log(`  s.html [${r.status}]: ${r.body.slice(0, 500)}`);
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
  console.log('\n[5] callback:', JSON.stringify(cb, null, 2));

  fs.writeFileSync('/tmp/jd_track/phase8_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
