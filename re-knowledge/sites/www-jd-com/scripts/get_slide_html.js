const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'jd_slide_container';
    div.style.cssText = 'position:fixed;top:200px;left:200px;width:360px;height:300px;';
    document.body.appendChild(div);
  });
  await page.evaluate(async () => {
    return new Promise((resolve) => {
      initJdSlide({
        id: 'jd_slide_container',
        protocol: 'https',
        lang: 'zh-CN',
        productId: '1',
        product: 'embed',
        scene: 'login_pc',
        appId: '1604ebb2287',
        width: 360,
      }, (d) => { window.__d = d; resolve(); });
      setTimeout(resolve, 8000);
    });
  });
  await new Promise(r => setTimeout(r, 2000));
  // 输出完整 HTML
  const html = await page.evaluate(() => document.querySelector('#jd_slide_container').innerHTML);
  console.log('=== 完整 HTML ===');
  console.log(html);
  // 输出所有有尺寸的元素
  const els = await page.evaluate(() => {
    const wrap = document.querySelector('#jd_slide_container');
    const result = [];
    const walk = (el, depth) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        result.push({ depth, tag: el.tagName, cls: el.className, x: r.x, y: r.y, w: r.width, h: r.height });
      }
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(wrap, 0);
    return result;
  });
  console.log('=== 所有有尺寸元素 ===');
  for (const e of els) console.log('  '.repeat(e.depth) + `${e.tag}.${e.cls} x=${e.x.toFixed(0)} y=${e.y.toFixed(0)} w=${e.w.toFixed(0)} h=${e.h.toFixed(0)}`);
  await browser.close();
})();
