/**
 * 阶段 5 (修订6): 检查 slideBtn computed style
 */

const puppeteer = require('puppeteer-core');

(async () => {
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

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:100px;left:200px;width:360px;height:300px;z-index:99999;background:#fff;border:1px solid red;';
    document.body.appendChild(div);
  });

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
      }, (d) => { window.__slideData = d; resolve(); });
      setTimeout(resolve, 30000);
    });
  });

  await new Promise(r => setTimeout(r, 5000));

  // 检查 slideBtn
  const info = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (!btn) return { err: 'no btn' };
    const cs = window.getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    return {
      class: btn.className,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      width: cs.width,
      height: cs.height,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      inlineStyle: btn.getAttribute('style') || '',
      parentClass: btn.parentElement.className,
      parentDisplay: window.getComputedStyle(btn.parentElement).display,
    };
  });
  console.log('=== slideBtn info ===');
  console.log(JSON.stringify(info, null, 2));

  // 强制设置 inline style
  console.log('\n=== 强制设置 inline style ===');
  await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    btn.style.display = 'block';
    btn.style.width = '55px';
    btn.style.height = '55px';
    btn.style.background = 'red';
    btn.style.zIndex = '99999';
  });
  await new Promise(r => setTimeout(r, 200));

  const after = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    const cs = window.getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    return {
      display: cs.display,
      width: cs.width,
      height: cs.height,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      inlineStyle: btn.getAttribute('style') || '',
    };
  });
  console.log(JSON.stringify(after, null, 2));

  // 找 jdSlide 实例
  const hasInstance = await page.evaluate(() => {
    return {
      hasInitJdSlide: typeof initJdSlide,
      hasJDJRValidate: typeof JDJRValidate,
      allInstances: Object.keys(window).filter(k => k.toLowerCase().includes('jd') || k.toLowerCase().includes('slide')),
    };
  });
  console.log('\n=== instances ===');
  console.log(JSON.stringify(hasInstance, null, 2));

  await browser.close();
})();
