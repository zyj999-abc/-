#!/usr/bin/env node
/**
 * 看 jdSlide 实例内部状态
 */

const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('iv.jd.com') || url.includes('ivs.jd.com') || url.includes('joybuy.com')) {
      try {
        respLog.push({ url, body: (await resp.text()).slice(0, 500) });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  // 强制调用 smartInitSlide
  const state = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (typeof window.smartInitSlide === 'function') {
          clearInterval(check);
          try {
            window.smartInitSlide();
          } catch (e) {}
          setTimeout(() => {
            // 5 秒后看状态
            const out = {
              jdSlideType: typeof window.jdSlide,
              jdSlideMethods: window.jdSlide ? Object.keys(window.jdSlide).slice(0, 20) : null,
              jdSlideIsObj: typeof window.jdSlide === 'object',
              jdSlideProto: window.jdSlide ? Object.getPrototypeOf(window.jdSlide).constructor.name : null,
              initJdSlideExists: typeof window.initJdSlide,
              JDJRVSlide: typeof window.JDJRVSlide,
              jdJRValidate: typeof window.JDJRValidate,
              jcap: typeof window.jcap,
              jdValidate: typeof window.jdValidate,
              loginsubmitInner: document.querySelector('#loginsubmit') ? document.querySelector('#loginsubmit').outerHTML.slice(0, 800) : null,
              // 找所有 JDJRV
              JDJRVs: Array.from(document.querySelectorAll('[class*=JDJRV]')).map(e => e.className + ' size=' + e.offsetWidth + 'x' + e.offsetHeight),
              // 找 jdSlide 实例内部状态
              jdSlideState: window.jdSlide && window.jdSlide.getState ? window.jdSlide.getState() : 'no getState',
            };
            resolve(out);
          }, 5000);
        }
      }, 200);
      setTimeout(() => { clearInterval(check); resolve({ timeout: true }); }, 10000);
    });
  });
  console.log('state:', JSON.stringify(state, null, 2));

  // 再等 10s 看是否后续会创建
  await sleep(10000);
  const state2 = await page.evaluate(() => {
    return {
      JDJRVs: Array.from(document.querySelectorAll('[class*=JDJRV]')).map(e => e.className + ' size=' + e.offsetWidth + 'x' + e.offsetHeight),
      loginsubmitInner: document.querySelector('#loginsubmit') ? document.querySelector('#loginsubmit').outerHTML.slice(0, 1500) : null,
      jdSlideState: window.jdSlide && window.jdSlide.getState ? window.jdSlide.getState() : 'no getState',
    };
  });
  console.log('\nstate2:', JSON.stringify(state2, null, 2));

  console.log('\nrespLog:');
  for (const r of respLog) {
    console.log('  ', r.url);
    console.log('    ', r.body.slice(0, 200));
  }

  await page.screenshot({ path: '/tmp/jd_track/jdSlide_state.png', fullPage: true });
  await browser.close();
})();
