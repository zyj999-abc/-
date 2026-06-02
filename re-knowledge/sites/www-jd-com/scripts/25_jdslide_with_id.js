/**
 * 阶段 4-6 最终: 真实拖动 jdSlide 拿 w
 *
 * 关键: params.id 必须是 DOM 元素 id
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
const PASSWORD = `Pwd${randomStr(8)}!@#`;

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

  const apiLog = [];
  const respLog = [];
  page.on('request', (req) => {
    if (req.url().match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService/)) {
      apiLog.push({ ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
    }
  });
  page.on('response', async (resp) => {
    if (resp.url().match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url: resp.url(), status: resp.status(), body: txt, setCookie: resp.headers()['set-cookie'] });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 passport.jd.com ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 创建滑块容器
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:200px;left:200px;width:360px;height:200px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

  // 调 initJdSlide 拿 jdSlide 实例
  console.log('\n[2] 调 initJdSlide 拿实例...');
  await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const config = {
        id: 'jd_slide_container',  // ⚡ 必须的 id
        protocol: 'https',
        lang: 'zh-CN',
        productId: '1',
        product: 'embed',
        scene: 'login_pc',
        account: 'test_user_12345',
        appId: '1604ebb2287',
        width: 360,
      };
      initJdSlide(config, function(slideData) {
        console.log('  [callback]', JSON.stringify(slideData).slice(0, 500));
        window.__slideData = slideData;
        resolve();
      });
      setTimeout(reject, 20000);
    });
  }).catch(e => console.log('  initJdSlide err:', e));

  // 等滑块完全加载
  await new Promise(r => setTimeout(r, 5000));

  await page.screenshot({ path: '/tmp/jd_track/slide_loaded.png', fullPage: true });

  // 看滑块 UI 元素
  const slideUI = await page.evaluate(() => {
    const wrap = document.querySelector('#jd_slide_container');
    if (!wrap) return { err: 'no container' };
    const slideBtn = wrap.querySelector('.JDJRV-slide-btn') || wrap.querySelector('.JDJRV-slide-inner') || wrap.querySelector('[class*="btn"]') || wrap.querySelector('[class*="slide"]');
    const slideImg = wrap.querySelector('.JDJRV-big-img') || wrap.querySelector('[class*="img"]');
    const result = {
      wrapHTML: wrap.innerHTML.slice(0, 500),
      allElements: wrap.querySelectorAll('*').length,
    };
    if (slideBtn) {
      const r = slideBtn.getBoundingClientRect();
      result.btn = { x: r.x, y: r.y, w: r.width, h: r.height, cls: slideBtn.className };
    }
    if (slideImg) {
      const r = slideImg.getBoundingClientRect();
      result.img = { x: r.x, y: r.y, w: r.width, h: r.height, cls: slideImg.className };
    }
    return result;
  });
  console.log('\n[3] 滑块 UI:');
  console.log(JSON.stringify(slideUI, null, 2).slice(0, 1500));

  // 看 jdSlide 后端 API 调用
  const slideApis = apiLog.filter(a => a.url.includes('iv.jd.com') || a.url.includes('iv.joybuy'));
  console.log(`\n[4] jdSlide API: ${slideApis.length} 条`);
  for (const a of slideApis) {
    console.log(`  [${a.method}] ${a.url}`);
  }
  const slideResps = respLog.filter(r => r.url.includes('iv.jd.com') || r.url.includes('iv.joybuy'));
  console.log(`[5] jdSlide 响应: ${slideResps.length} 条`);
  for (const r of slideResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 100)}`);
    console.log(`    body: ${r.body.slice(0, 500)}`);
  }

  // 如果有滑块按钮，真实拖动
  if (slideUI.btn) {
    const btn = slideUI.btn;
    const startX = btn.x + btn.w / 2;
    const startY = btn.y + btn.h / 2;
    // 滑块通常 360px 宽，目标位置大约 250-300px
    const endX = startX + 250;
    const endY = startY;

    console.log(`\n[6] 真实拖动滑块: (${startX}, ${startY}) -> (${endX}, ${endY})`);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 模拟人类缓慢拖动 + 抖动
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = startX + (endX - startX) * t;
      // 抖动：开始和结束慢，中间快
      const y = startY + Math.sin(t * Math.PI * 1.5) * 3;
      await page.mouse.move(x, y, { steps: 1 });
      await new Promise(r => setTimeout(r, 30 + Math.random() * 30));
    }
    await new Promise(r => setTimeout(r, 500));
    await page.mouse.up();

    console.log('  拖动完成，等 callback 触发...');
    await new Promise(r => setTimeout(r, 8000));
  }

  // 看 callback 数据
  const finalSlideData = await page.evaluate(() => window.__slideData);
  console.log('\n[7] callback 数据:');
  console.log(JSON.stringify(finalSlideData, null, 2).slice(0, 1500));

  // 看最新的 jdSlide 响应
  console.log('\n[8] 所有 jdSlide 响应:');
  for (const r of respLog.filter(r => r.url.includes('iv.jd.com') || r.url.includes('iv.joybuy'))) {
    console.log(`  [${r.status}] ${r.url.slice(0, 100)}`);
    console.log(`    body: ${r.body.slice(0, 800)}`);
  }

  fs.writeFileSync('/tmp/jd_track/slide_drag2_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/slide_drag2_resps.json', JSON.stringify(respLog, null, 2));
  await page.screenshot({ path: '/tmp/jd_track/slide_dragged2.png', fullPage: true });

  await browser.close();
})();
