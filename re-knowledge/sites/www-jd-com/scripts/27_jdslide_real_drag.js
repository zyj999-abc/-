/**
 * 阶段 5: 真实 mouse 拖动 jdSlide 拿 validate
 *
 * 关键改进:
 *   1. 用真实 page.mouse API (不是 dispatchEvent) 拖动
 *   2. 确保 CSS 加载完 (等 dom ready + 资源加载)
 *   3. 等 callback 触发拿 validate token
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

  // 拿 jdSlide 实例
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

  // 等 CSS 加载完 + DOM 渲染完
  const slideReady = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (!btn) return { ready: false, err: 'no btn' };
    const r = btn.getBoundingClientRect();
    // 强制设置按钮尺寸 (因为可能被无样式情况)
    if (r.width < 5) {
      // 看 slideBtn bgImg 或父元素有没有 img
      const wrap = document.querySelector('#jd_slide_container');
      const all = wrap.querySelectorAll('*');
      // 等 CSS 加载
      return { ready: false, w: r.width, h: r.height, msg: 'btn too small, CSS not loaded' };
    }
    return { ready: true, w: r.width, h: r.height, x: r.x, y: r.y };
  });
  console.log('\n[3] slide ready:', JSON.stringify(slideReady));

  if (!slideReady.ready) {
    // 强制给 slideBtn 加 size + cursor:pointer
    console.log('  强制设置样式...');
    await page.evaluate(() => {
      const btn = document.querySelector('.JDJRV-slide-btn');
      btn.style.cssText = 'position:absolute;left:0;top:0;width:50px;height:50px;background:red;cursor:pointer;z-index:99999;';
    });
  }

  // 真实拖动
  const btnInfo = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const r = btn.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log('\n[4] btn:', JSON.stringify(btnInfo));

  const startX = btnInfo.x + btnInfo.w / 2;
  const startY = btnInfo.y + btnInfo.h / 2;
  const endX = startX + 250;  // 滑到中间位置
  console.log(`  拖动 (${startX}, ${startY}) -> (${endX}, ${startY})`);

  // 用 page.mouse API 真实拖动
  await page.mouse.move(startX, startY);
  await new Promise(r => setTimeout(r, 200));
  await page.mouse.down();
  // 40 步缓慢拖动，模拟人类
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // ease-out
    const ease = 1 - Math.pow(1 - t, 2);
    const x = startX + (endX - startX) * ease;
    // 抖动
    const jitter = Math.sin(t * Math.PI * 2) * 1.5;
    const y = startY + jitter;
    await page.mouse.move(x, y, { steps: 1 });
    await new Promise(r => setTimeout(r, 25 + Math.random() * 25));
  }
  await new Promise(r => setTimeout(r, 400));
  await page.mouse.up();
  console.log('  拖动完成');

  // 等 callback
  await new Promise(r => setTimeout(r, 10000));

  await page.screenshot({ path: '/tmp/jd_track/slide_real_drag.png', fullPage: true });

  // 看 jdSlide 后端响应
  const sResps = respLog.filter(r => r.url.includes('s.html'));
  const gResps = respLog.filter(r => r.url.includes('g.html'));
  console.log(`\n[5] g.html 响应 (${gResps.length} 条):`);
  for (const r of gResps) {
    const body = r.body.length > 600 ? r.body.slice(0, 600) + '...' : r.body;
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${body}`);
  }
  console.log(`\n[6] s.html 响应 (${sResps.length} 条):`);
  for (const r of sResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 400)}`);
    console.log(`    body: ${r.body.slice(0, 1500)}`);
  }

  // callback
  const cb = await page.evaluate(() => window.__slideData);
  console.log('\n[7] callback 数据:');
  console.log(JSON.stringify(cb, null, 2).slice(0, 2000));

  // 关键: getValidate()
  let validate = null;
  if (cb) {
    try {
      if (typeof cb.getValidate === 'function') {
        validate = cb.getValidate();
      } else if (cb.validate) {
        validate = cb.validate;
      }
    } catch (e) {}
  }
  console.log('\n[8] validate token:', validate);

  fs.writeFileSync('/tmp/jd_track/drag4_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
