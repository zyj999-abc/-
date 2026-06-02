/**
 * 阶段 5 (修订5): 触发 jdSlide 加载链，看 style.css 加载情况
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

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

  const allReqs = [];
  const allResps = [];
  page.on('request', (req) => {
    allReqs.push({ ts: Date.now(), method: req.method(), url: req.url() });
  });
  page.on('response', async (resp) => {
    const url = resp.url();
    try {
      const headers = resp.headers();
      const ct = headers['content-type'] || '';
      let body = '';
      if (ct.includes('css') || url.includes('.css') || url.includes('slide')) {
        try { body = await resp.text(); } catch (e) {}
      }
      allResps.push({ ts: Date.now(), url, status: resp.status(), ct, bodyLen: body.length, body: body.slice(0, 2000) });
    } catch (e) {}
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
      };
      initJdSlide(config, function(slideData) {
        window.__slideData = slideData;
        resolve();
      });
      setTimeout(resolve, 30000);
    });
  });

  await new Promise(r => setTimeout(r, 6000));

  // 看 CSS
  const cssFiles = allResps.filter(r => r.url.includes('.css') || r.ct.includes('css'));
  console.log(`\n[3] CSS 文件 (${cssFiles.length} 条):`);
  for (const r of cssFiles) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)} (${r.bodyLen} bytes)`);
    if (r.body) {
      // 找 JDJRV-slide-btn 相关 CSS
      const match = r.body.match(/\.JDJRV-slide-btn[^{]*\{[^}]+\}/);
      if (match) console.log(`    btn CSS: ${match[0]}`);
    }
  }

  fs.writeFileSync('/tmp/jd_track/drag8_resps.json', JSON.stringify(allResps, null, 2));
  fs.writeFileSync('/tmp/jd_track/drag8_reqs.json', JSON.stringify(allReqs, null, 2));
  await browser.close();
})();
