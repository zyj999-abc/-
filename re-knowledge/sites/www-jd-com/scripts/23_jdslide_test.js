/**
 * 阶段 4-6 重做: 用 jdSlide 滑块代替 jcap
 *
 * 关键:
 * - useSlideAuthCode=1 表示用 jdSlide 滑块
 * - jdSlide 通过 initJdSlide(config, callback) 创建
 * - 用户拖动滑块 → JDJRValidate 拿 w
 * - w 传到 loginService
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
    if (req.url().match(/loginService|jcap\.m\.jd|ivs\.jd|jra\.jd|cactus|sgm-|h5speed|geetest/)) {
      apiLog.push({ ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
    }
  });
  page.on('response', async (resp) => {
    if (resp.url().match(/loginService|jcap\.m\.jd|ivs\.jd|jra\.jd/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url: resp.url(), status: resp.status(), body: txt, setCookie: resp.headers()['set-cookie'] });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 探测 jdSlide 相关
  const slideConfig = await page.evaluate(() => ({
    initJdSlide: typeof initJdSlide,
    JDJRValidate: typeof JDJRValidate,
    slideAppId: $('#slideAppId').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    slideElement: $('#slideAuthCode').length,
  }));
  console.log('[1] jdSlide 探测:');
  console.log('  initJdSlide:', slideConfig.initJdSlide);
  console.log('  JDJRValidate:', slideConfig.JDJRValidate);
  console.log('  slideAppId:', slideConfig.slideAppId);
  console.log('  useSlideAuthCode:', slideConfig.useSlideAuthCode);
  console.log('  slideAuthCode 元素:', slideConfig.slideElement);

  // 探测 jdSlide 内部
  const jdSlideInfo = await page.evaluate(() => {
    const info = {
      globals: Object.keys(window).filter(k => /slide|jd|JR/i.test(k)),
    };
    if (typeof initJdSlide === 'function') {
      try {
        info.initJdSlideSource = initJdSlide.toString().slice(0, 500);
      } catch (e) {}
    }
    if (typeof JDJRValidate === 'function') {
      try {
        info.JDJRValidateSource = JDJRValidate.toString().slice(0, 500);
      } catch (e) {}
    }
    return info;
  });
  console.log('\n[2] jdSlide globals:', jdSlideInfo.globals);
  if (jdSlideInfo.initJdSlideSource) {
    console.log('  initJdSlide 源码:');
    console.log(jdSlideInfo.initJdSlideSource);
  }

  // 直接调用 initJdSlide 触发滑块
  console.log('\n[3] 触发 jdSlide 滑块流程...');
  const slideResult = await page.evaluate(async (form) => {
    return new Promise((resolve) => {
      if (typeof initJdSlide !== 'function') {
        resolve({ err: 'initJdSlide not defined' });
        return;
      }
      // initJdSlide(config, callback) - callback 接收 {w, tk, vt, ...}
      const config = {
        protocol: 'https',
        lang: 'zh-CN',
        productId: '1',
        sceneId: 'login_pc',
        account: 'test_user_12345',
        appId: '1604ebb2287',
      };
      initJdSlide(config, function(slideData) {
        console.log('  [callback]', JSON.stringify(slideData).slice(0, 500));
        resolve({ phase: 'callback', data: slideData });
      });
      // 等 12s
      setTimeout(() => {
        resolve({ phase: 'timeout', msg: 'no jdSlide callback' });
      }, 12000);
    });
  });

  console.log('  slideResult:', JSON.stringify(slideResult, null, 2).slice(0, 1000));

  await new Promise(r => setTimeout(r, 3000));

  console.log('\n[4] 网络请求:');
  for (const a of apiLog) {
    console.log(`  [${a.method}] ${a.url.slice(0, 100)}`);
    if (a.postData) console.log(`    body: ${a.postData.slice(0, 300)}`);
  }
  console.log('\n[5] 响应:');
  for (const r of respLog) {
    console.log(`  [${r.status}] ${r.url.slice(0, 100)}`);
    console.log(`    body: ${r.body.slice(0, 400)}`);
  }

  fs.writeFileSync('/tmp/jd_track/slide_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/slide_resps.json', JSON.stringify(respLog, null, 2));
  await page.screenshot({ path: '/tmp/jd_track/slide.png', fullPage: true });

  await browser.close();
})();
