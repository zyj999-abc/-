/**
 * 阶段 4-5 调试: 看 jcap 真正暴露的 API
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

  const apiLog = [];
  page.on('request', (req) => {
    if (req.url().includes('jcap.m.jd.com')) {
      apiLog.push({ ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 探测 jcap 暴露的全局
  console.log('=== 全局探测 ===');
  const globals = await page.evaluate(() => {
    const keys = Object.keys(window).filter(k => /jcap|captcha|geetest|jdCAP|JdCaptcha/i.test(k));
    return keys;
  });
  console.log('jcap-related globals:', globals);

  // 看 captchaLoadJS 是怎么定义的
  const captchaLoadJSDef = await page.evaluate(() => {
    if (typeof captchaLoadJS !== 'function') return 'undefined';
    return captchaLoadJS.toString().slice(0, 1500);
  });
  console.log('\n=== captchaLoadJS 源码 (前 1500 chars) ===');
  console.log(captchaLoadJSDef);

  // 看 captchaLoadJS 实际行为
  console.log('\n=== captchaLoadJS 实际行为测试 ===');
  const testResult = await page.evaluate(() => {
    return new Promise((resolve) => {
      const option = {
        appId: '1000803',
        sceneId: 'login_pc',
        account: 'test_user_12345',
        onSuccess: (data) => resolve({ phase: 'onSuccess', data: data }),
        onFailure: (err) => resolve({ phase: 'onFailure', err: String(err) }),
        onLoad: (info) => resolve({ phase: 'onLoad', info: String(info).slice(0, 300) }),
        onReady: () => resolve({ phase: 'onReady' }),
        onCancel: () => resolve({ phase: 'onCancel' }),
      };
      const ret = captchaLoadJS(option, (captchaIns) => {
        resolve({ phase: 'callback', captchaIns: String(captchaIns).slice(0, 200), keys: Object.keys(captchaIns || {}) });
      });
      // 8s timeout
      setTimeout(() => resolve({ phase: 'timeout', ret: String(ret).slice(0, 200) }), 8000);
    });
  });
  console.log('test result:', JSON.stringify(testResult, null, 2).slice(0, 1500));

  await new Promise(r => setTimeout(r, 3000));
  console.log('\n=== jcap 网络请求 ===');
  for (const a of apiLog) {
    console.log(`  [${a.method}] ${a.url}`);
    if (a.postData) console.log(`    body: ${a.postData.slice(0, 400)}`);
  }

  // 看 jcap 内部的 jdCAP / JdCaptcha 对象
  console.log('\n=== jdCAP / JdCaptcha 内部结构 ===');
  const jcapInternal = await page.evaluate(() => {
    if (typeof jdCAP === 'undefined') return 'jdCAP undefined';
    return JSON.stringify({
      keys: Object.keys(jdCAP),
      types: Object.fromEntries(Object.entries(jdCAP).map(([k, v]) => [k, typeof v])),
    }, null, 2);
  });
  console.log(jcapInternal);

  // 看 jdCAP.captcha 实际方法
  const captchaFn = await page.evaluate(() => {
    if (typeof jdCAP?.captcha !== 'function') return 'jdCAP.captcha not function';
    return jdCAP.captcha.toString().slice(0, 1500);
  });
  console.log('\n=== jdCAP.captcha 源码 ===');
  console.log(captchaFn);

  fs.writeFileSync('/tmp/jd_track/jcap_probe_apis.json', JSON.stringify(apiLog, null, 2));
  await browser.close();
})();
