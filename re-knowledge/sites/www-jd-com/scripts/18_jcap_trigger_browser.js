/**
 * 阶段 4-5: 用真实 Chrome + 随机测试账号触发 jcap 完整流程
 *
 * 关键点:
 * - 加大量反检测 (webdriver、navigator、chrome.runtime、permissions)
 * - 启动浏览器 (不是 headless 模式但通过 Xvfb) 或用 headless=new 模拟更真实
 * - 随机生成测试账号密码
 * - 完整填表 + 点击登录
 * - 拦截 jcap fp / check / verify 全部 API
 * - 拿 si / fp / st / vt 用于协议化登录
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

// 随机测试账号生成
const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const USERNAME = `jdtest${randomStr(6)}@163.com`;
const PASSWORD = `Pwd${randomStr(8)}!@#`;

(async () => {
  console.log(`[配置] 测试账号: ${USERNAME} / 密码: ${PASSWORD}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--ignore-certificate-errors',
      '--disable-web-security',
      '--disable-features=AudioServiceOutOfProcess',
      '--window-size=1366,768',
    ],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  // 设置真实 UA
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

  // ===== 反检测 =====
  await page.evaluateOnNewDocument(() => {
    // 1. 隐藏 webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // 2. Chrome runtime
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    // 3. Permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) : originalQuery(parameters);
    // 4. Languages
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    // 5. Plugins
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // 6. WebGL vendor
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });

  // 拦截所有 API 调用
  const apiLog = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/loginService|jcap\.m\.jd|geetest|seq\.|cactus|jra|sgm-|ivs\.|gia\.|h5speed/.test(u)) {
      apiLog.push({
        ts: Date.now(),
        method: req.method(),
        url: u,
        postData: req.postData(),
        headers: req.headers(),
      });
    }
  });
  const respLog = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/loginService|jcap\.m\.jd|geetest/.test(u)) {
      try {
        const txt = await resp.text();
        respLog.push({
          ts: Date.now(),
          url: u,
          status: resp.status(),
          body: txt.slice(0, 2000),
          setCookie: resp.headers()['set-cookie'],
        });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 passport.jd.com ...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 抓 form 字段
  const form = await page.evaluate(() => ({
    uuid: $('#uuid').val(),
    eid: $('#eid').val(),
    fp: $('#sessionId').val(),
    eid2: $('#eid2').val(),
    token: $('#token').val(),
    loginType: $('#loginType').val(),
    sa_token: $('#sa_token').val()?.slice(0, 50) + '...',
    sa_token_len: $('#sa_token').val()?.length,
    pubKey: $('#pubKey').val()?.slice(0, 50) + '...',
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    graphicCaptchaStatus: $('#graphicCaptchaStatus').val(),
    graphicCaptchaAppId: $('#graphicCaptchaAppId').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val()?.slice(0, 30) + '...',
  }));
  console.log('[2] form 字段已抓取:');
  console.log('  uuid:', form.uuid);
  console.log('  eid (90 chars):', form.eid?.slice(0, 30) + '...');
  console.log('  fp (32 chars):', form.fp);
  console.log('  eid2 (128 chars):', form.eid2?.slice(0, 50) + '...');
  console.log('  sa_token length:', form.sa_token_len);
  console.log('  useSlideAuthCode:', form.useSlideAuthCode);
  console.log('  graphicCaptchaStatus:', form.graphicCaptchaStatus);

  // ===== 填表 =====
  console.log('\n[3] 填入随机测试账号...');
  await page.type('#loginname', USERNAME, { delay: 30 });
  await page.type('#nloginpwd', PASSWORD, { delay: 30 });
  await new Promise(r => setTimeout(r, 1500));

  // ===== 触发 jcap 流程 =====
  // 直接调用 loginSubmit（这样会触发 jcap fp + check + 显示图片码）
  console.log('\n[4] 调用 loginSubmit 触发 jcap ...');

  // 在点击登录按钮之前先记录
  const beforeCount = apiLog.length;
  console.log(`  当前 api 数量: ${beforeCount}`);

  try {
    // 方案 A: 直接调 captchaLoadJS 创建 captcha instance
    // 关键：必须传 account, appId, sessionId, onSuccess, onFailure, onLoad
    console.log('  [A] 调 captchaLoadJS 创建 captcha instance ...');
    const captchaInstance = await page.evaluate((USERNAME) => {
      return new Promise((resolve, reject) => {
        if (typeof captchaLoadJS === 'function') {
          // 创建一个容器元素
          const container = document.createElement('div');
          container.id = 'jcap-container-temp';
          container.style.cssText = 'position:fixed;top:10px;right:10px;width:300px;height:200px;z-index:99999;background:#fff;border:1px solid red;';
          document.body.appendChild(container);

          captchaLoadJS({
            appId: '1000803',
            sceneId: 'login_pc',
            account: USERNAME,
            sessionId: $('#graphicCaptchaSessionId').val(),
            element: container,
            lang: 'zh-CN',
            onSuccess: (data) => {
              console.log('  [onSuccess] vt =', data);
              resolve({ ok: true, phase: 'onSuccess', vt: data.vt || data, data: data });
            },
            onFailure: (err) => {
              console.log('  [onFailure]', err);
              resolve({ ok: false, phase: 'onFailure', err: String(err) });
            },
            onLoad: (info) => {
              console.log('  [onLoad]', info);
              // resolve({ ok: true, phase: 'onLoad', info: info });
            },
            onReady: () => {
              console.log('  [onReady] captcha ready, can be shown');
              // resolve({ ok: true, phase: 'onReady' });
            },
            onCancel: () => {
              console.log('  [onCancel]');
            }
          });
          // 10s timeout
          setTimeout(() => reject(new Error('timeout 10s - no jcap response')), 10000);
        } else {
          reject(new Error('captchaLoadJS not defined'));
        }
      });
    }, USERNAME);
    console.log('  captcha instance:', JSON.stringify(captchaInstance, null, 2).slice(0, 800));
  } catch (e) {
    console.log('  [A] 失败:', e.message);
  }

  await new Promise(r => setTimeout(r, 5000));

  // 抓 jcap 完整抓包
  const jcapApis = apiLog.filter(a => a.url.includes('jcap.m.jd.com'));
  console.log(`\n[5] jcap API 调用: ${jcapApis.length} 条`);
  for (const a of jcapApis) {
    console.log(`  [${a.method}] ${a.url.slice(0, 100)}`);
    if (a.postData) console.log(`    body: ${a.postData.slice(0, 300)}`);
  }
  const jcapResps = respLog.filter(r => r.url.includes('jcap.m.jd.com'));
  console.log(`\n[6] jcap responses: ${jcapResps.length} 条`);
  for (const r of jcapResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 100)}`);
    console.log(`    body: ${r.body.slice(0, 500)}`);
  }

  // 看是否有 verify 调用
  const verifyApis = apiLog.filter(a => a.url.includes('verify'));
  console.log(`\n[7] verify API: ${verifyApis.length} 条`);
  for (const a of verifyApis) {
    console.log(`  [${a.method}] ${a.url}`);
    console.log(`    body: ${a.postData}`);
  }

  // 看是否有图形验证码 base64 图片
  const checkResp = jcapResps.find(r => r.url.includes('/check'));
  if (checkResp) {
    try {
      const data = JSON.parse(checkResp.body);
      console.log('\n[8] jcap.check 响应解析:');
      console.log('  tp:', data.tp);
      console.log('  st:', data.st);
      console.log('  code:', data.code);
      console.log('  msg:', data.msg);
      if (data.img) {
        console.log('  img length:', data.img.length);
        // 解析 b1 / b2 / ...
        try {
          const imgObj = typeof data.img === 'string' ? JSON.parse(data.img) : data.img;
          console.log('  img keys:', Object.keys(imgObj));
          for (const [k, v] of Object.entries(imgObj)) {
            if (typeof v === 'string' && v.startsWith('data:image')) {
              console.log(`  ${k}: ${v.slice(0, 50)}... (${v.length} chars)`);
            } else {
              console.log(`  ${k}:`, v);
            }
          }
        } catch (e) {
          console.log('  img raw:', String(data.img).slice(0, 200));
        }
      }
    } catch (e) {
      console.log('  parse err:', e.message);
    }
  }

  // 保存所有抓包
  fs.writeFileSync('/tmp/jd_track/jcap_browser_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/jcap_browser_resps.json', JSON.stringify(respLog, null, 2));
  console.log('\n[9] 抓包已保存到 /tmp/jd_track/jcap_browser_*.json');

  await page.screenshot({ path: '/tmp/jd_track/jcap_triggered.png', fullPage: true });
  console.log('  截图: /tmp/jd_track/jcap_triggered.png');

  await browser.close();
})();
