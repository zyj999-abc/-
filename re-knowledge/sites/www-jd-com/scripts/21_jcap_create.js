/**
 * 阶段 4-5: 触发 jcap 完整流程 (appCheck / create)
 *
 * 关键发现: captcha instance 有 create() 和 appCheck() 方法，
 *          调它们会触发 jcap fp → check 网络请求。
 *
 * 目标:
 * - 调 captchaIns.create() / appCheck() 触发 jcap fp / check
 * - 拦截所有 jcap 网络请求 + 响应
 * - 看 jcap verify 接口协议
 * - 拿 si / fp / st / vt
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
  console.log(`[配置] USERNAME: ${USERNAME} / PASSWORD: ${PASSWORD}`);

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
    if (req.url().includes('jcap.m.jd.com') || req.url().includes('loginService')) {
      apiLog.push({ ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
    }
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('jcap.m.jd.com') || resp.url().includes('loginService')) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url: resp.url(), status: resp.status(), body: txt.slice(0, 3000) });
      } catch (e) {}
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  await page.type('#loginname', USERNAME, { delay: 30 });
  await page.type('#nloginpwd', PASSWORD, { delay: 30 });
  await new Promise(r => setTimeout(r, 2000));

  // 拿真实 sessionId
  const sessionId = await page.evaluate(() => $('#graphicCaptchaSessionId').val());
  const jwtToken = await page.evaluate(() => $('#graphicCaptchaJwtToken').val());
  console.log(`[0] graphicCaptchaSessionId: ${sessionId?.slice(0, 30)}...`);
  console.log(`    graphicCaptchaJwtToken: ${jwtToken?.slice(0, 30)}...`);

  console.log('\n[1] 创建 captcha instance 并调 create() / appCheck() ...');

  // 1. 创建 captcha instance
  // 2. 调 create() 触发 fp
  // 3. 调 appCheck() 触发 check
  const flowResult = await page.evaluate(async (USERNAME, sessionId) => {
    return new Promise((resolve) => {
      if (typeof captchaLoadJS !== 'function') {
        resolve({ err: 'captchaLoadJS not defined' });
        return;
      }

      const option = {
        appId: '1000803',
        sceneId: 'login_pc',
        account: USERNAME,
        sessionId: sessionId,  // ⚡ 关键：从 login 页拿真实 sessionId
        element: document.body,
        lang: 'zh-CN',
        onSuccess: (data) => resolve({ phase: 'onSuccess', data: data }),
        onFailure: (err) => resolve({ phase: 'onFailure', err: String(err) }),
        onLoad: (info) => console.log('onLoad', info),
        onReady: () => console.log('onReady'),
        onCancel: () => console.log('onCancel'),
      };

      captchaLoadJS(option, (captchaIns) => {
        console.log('callback called, captchaIns keys:', Object.keys(captchaIns || {}));

        // 列出所有方法
        const proto = Object.getPrototypeOf(captchaIns);
        const allMethods = Object.getOwnPropertyNames(proto || {}).concat(Object.keys(captchaIns || {}));

        // 调 appCheck() 触发 jcap check
        let createErr = null;
        let appCheckErr = null;
        try {
          if (typeof captchaIns.appCheck === 'function') {
            captchaIns.appCheck();
            console.log('appCheck() called');
          } else {
            appCheckErr = 'appCheck not a function';
          }
        } catch (e) {
          appCheckErr = String(e);
        }
        try {
          if (typeof captchaIns.create === 'function') {
            captchaIns.create();
            console.log('create() called');
          } else {
            createErr = 'create not a function';
          }
        } catch (e) {
          createErr = String(e);
        }

        resolve({
          phase: 'callback',
          methods: allMethods,
          hasAppCheck: typeof captchaIns.appCheck === 'function',
          hasCreate: typeof captchaIns.create === 'function',
          createErr: createErr,
          appCheckErr: appCheckErr,
          sessionId: captchaIns.getSessionId ? captchaIns.getSessionId() : 'N/A',
          options: { appId: captchaIns.options?.appId, account: captchaIns.options?.account, sessionId: captchaIns.options?.sessionId },
          info: { appType: captchaIns.info?.appType, tdat_version: captchaIns.info?.tdat_version, host: captchaIns.info?.host },
        });
      });

      setTimeout(() => resolve({ err: 'overall timeout 12s' }), 12000);
    });
  }, USERNAME, sessionId);

  console.log('\n[2] flowResult:');
  console.log(JSON.stringify(flowResult, null, 2));

  await new Promise(r => setTimeout(r, 5000));

  // 看 jcap 请求
  const jcapApis = apiLog.filter(a => a.url.includes('jcap.m.jd.com'));
  console.log(`\n[3] jcap API: ${jcapApis.length} 个`);
  for (const a of jcapApis) {
    console.log(`  [${a.method}] ${a.url}`);
    if (a.postData) console.log(`    body: ${a.postData.slice(0, 600)}`);
  }

  const jcapResps = respLog.filter(r => r.url.includes('jcap.m.jd.com'));
  console.log(`\n[4] jcap 响应: ${jcapResps.length} 个`);
  for (const r of jcapResps) {
    console.log(`  [${r.status}] ${r.url}`);
    console.log(`    body: ${r.body.slice(0, 600)}`);
  }

  // 看 verify 请求
  const verifyApis = jcapApis.filter(a => a.url.includes('verify'));
  console.log(`\n[5] verify API: ${verifyApis.length} 个`);
  for (const a of verifyApis) {
    console.log(`  [${a.method}] ${a.url}`);
    console.log(`    body: ${a.postData}`);
  }
  const verifyResps = jcapResps.filter(r => r.url.includes('verify'));
  console.log(`\n[6] verify 响应: ${verifyResps.length} 个`);
  for (const r of verifyResps) {
    console.log(`  [${r.status}] ${r.url}`);
    console.log(`    body: ${r.body}`);
  }

  fs.writeFileSync('/tmp/jd_track/jcap3_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/jcap3_resps.json', JSON.stringify(respLog, null, 2));
  await page.screenshot({ path: '/tmp/jd_track/jcap3.png', fullPage: true });
  console.log('\n抓包已保存到 /tmp/jd_track/jcap3_*.json');

  await browser.close();
})();
