/**
 * 阶段 5 (修订3): 修 btn 位置 - 不脱离 slide-bg
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

  // 看 jdSlide 内部 slideBtn 是怎么被 position
  // 关键: 不要破坏 jdSlide 的内部计算
  // 直接用 dispatchEvent (在 slideBtn 元素上 + document 上)
  // 这次不修改 btn style，而是用真实 mouse 在 btn 实际位置触发
  const btnInfo = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const bg = btn.parentElement;
    const bgR = bg.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    return {
      btn: { x: r.x, y: r.y, w: r.width, h: r.height },
      bg: { x: bgR.x, y: bgR.y, w: bgR.width, h: bgR.height },
    };
  });
  console.log('\n[3] btn info:', JSON.stringify(btnInfo));

  // 即使 h=0 也尝试在 btn 中心触发
  // 实际上 page.mouse.move(startX, startY) 不会触发 mousedown 因为 element 在 h=0 区域
  // 改用真实元素上 mousedown

  // 改方案: 不靠真实 mouse，直接 evaluate 内部触发
  // 但先用真实 mouse 走一遍试试 (用 btn.getCenter 但 h=0)
  const sx = btnInfo.btn.x + btnInfo.btn.w / 2;
  const sy = btnInfo.btn.y + btnInfo.btn.h / 2;
  console.log(`  真实 mouse 位置: (${sx}, ${sy})`);

  // 用真实 mouse API
  await page.mouse.move(sx, sy);
  await new Promise(r => setTimeout(r, 200));
  await page.mouse.down();
  await new Promise(r => setTimeout(r, 100));

  // 在 bg 内移动
  const startX = sx;
  const startY = btnInfo.bg.y + 9;  // bg 中心
  const endX = btnInfo.bg.x + 250;
  const steps = 50;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = 1 - Math.pow(1 - t, 2);
    const x = startX + (endX - startX) * ease;
    const y = startY + Math.sin(t * Math.PI * 2) * 1.2;
    await page.mouse.move(x, y, { steps: 1 });
    await new Promise(r => setTimeout(r, 25 + Math.random() * 20));
  }
  await new Promise(r => setTimeout(r, 500));
  await page.mouse.up();
  console.log('  真实 mouse 拖动完成');

  await new Promise(r => setTimeout(r, 10000));
  await page.screenshot({ path: '/tmp/jd_track/slide_drag_real2.png', fullPage: true });

  const sResps = respLog.filter(r => r.url.includes('s.html'));
  const gResps = respLog.filter(r => r.url.includes('g.html'));
  console.log(`\n[4] g.html 响应 (${gResps.length} 条)`);
  console.log(`[5] s.html 响应 (${sResps.length} 条):`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 400)}`);
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

  fs.writeFileSync('/tmp/jd_track/drag6_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
