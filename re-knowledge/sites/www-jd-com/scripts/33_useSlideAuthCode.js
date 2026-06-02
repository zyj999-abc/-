/**
 * 阶段 6: 真实京东登录流程触发 jdSlide
 *
 * 策略: 用 useSlideAuthCode 或触发真实 login 流程
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
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 passport.jd.com ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 看 useSlideAuthCode 是什么
  const useInfo = await page.evaluate(() => {
    return {
      useSlideAuthCode_type: typeof useSlideAuthCode,
      useSlideAuthCode_src: useSlideAuthCode ? useSlideAuthCode.toString().slice(0, 1000) : null,
    };
  });
  console.log('\n[2] useSlideAuthCode:');
  console.log(JSON.stringify(useInfo, null, 2));

  // 用 useSlideAuthCode 调 jdSlide
  console.log('\n[3] 调 useSlideAuthCode 触发 jdSlide...');
  await page.evaluate(async () => {
    return new Promise((resolve) => {
      if (typeof useSlideAuthCode !== 'function') {
        window.__slideData = { err: 'no useSlideAuthCode' };
        return resolve();
      }
      // useSlideAuthCode 签名
      try {
        const ret = useSlideAuthCode({
          elem: document.querySelector('#jd_slide_container') || document.body,
          productId: '1',
          product: 'embed',
          scene: 'login_pc',
          appId: '1604ebb2287',
          width: 360,
          account: 'jd_test_user_12345',
        }, function(slideData) {
          window.__slideData = slideData;
          resolve();
        });
        console.log('useSlideAuthCode ret:', ret);
      } catch (e) {
        window.__slideData = { err: e.message };
        resolve();
      }
      setTimeout(resolve, 30000);
    });
  });
  console.log('  result:', JSON.stringify(await page.evaluate(() => window.__slideData)).slice(0, 500));

  await new Promise(r => setTimeout(r, 5000));

  // 看 slide-btn 状态
  const btnInfo = await page.evaluate(() => {
    const btn = document.querySelector('.JDJRV-slide-btn');
    if (!btn) return { err: 'no btn' };
    const cs = window.getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    return {
      display: cs.display,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      class: btn.className,
      parentClass: btn.parentElement.className,
    };
  });
  console.log('\n[4] slideBtn:', JSON.stringify(btnInfo, null, 2));

  fs.writeFileSync('/tmp/jd_track/phase6_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
