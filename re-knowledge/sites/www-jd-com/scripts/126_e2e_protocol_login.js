#!/usr/bin/env node
/**
 * 126_e2e_protocol_login.js
 *
 * 端到端协议化京东登录 - 关键设计：
 * 1. 浏览器侧只做"用户介入过 jcap"（一次性手动操作）
 * 2. 拿到 vt 后，**协议化构造 22 字段 POST body** + 调用 loginService
 * 3. 提取 pt_key/pt_pin cookie + 输出可重用的 cookie 串
 *
 * 与 jd_login_protocol.js 区别：
 * - jd_login_protocol.js 的 _solveJcap 返回 null（卡 jcap）
 * - 126 等用户手动过 jcap 后捕获 vt，再协议化 loginService
 *
 * 用户操作流程（一次性）：
 *   1. 启动脚本（headless: 'new' 模式无 X server）
 *   2. 脚本打开登录页 + 输入账号密码 + 触发 jcap
 *   3. jcap 弹窗出现 → 用户在脚本输出提示下手动拖动
 *   4. jcap 通过 → 脚本自动捕获 vt
 *   5. 脚本协议化 loginService → 拿 pt_key/pt_pin
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

puppeteer.use(StealthPlugin());

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ============================================
// 1. 贝塞尔曲线轨迹生成器
// ============================================
function bezierPath(p0, p1, p2, p3, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x;
    const y = u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y;
    points.push({ x, y, t });
  }
  return points;
}

async function realisticMouseMove(page, fromX, fromY, toX, toY, totalMs = 1500) {
  const steps = Math.max(20, Math.floor(totalMs / 30));
  const cp1 = { x: fromX + (toX - fromX) * 0.2 + (Math.random() - 0.5) * 20, y: fromY + (Math.random() - 0.5) * 15 };
  const cp2 = { x: fromX + (toX - fromX) * 0.8 + (Math.random() - 0.5) * 20, y: toY + (Math.random() - 0.5) * 15 };
  const path = bezierPath({ x: fromX, y: fromY }, cp1, cp2, { x: toX, y: toY }, steps);
  for (let i = 0; i < path.length; i++) {
    const t = i / path.length;
    const speed = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const noiseX = (Math.random() - 0.5) * 1.5;
    const noiseY = (Math.random() - 0.5) * 1.5;
    await page.mouse.move(path[i].x + noiseX, path[i].y + noiseY);
    const baseDelay = (1 - Math.abs(speed - 0.5) * 0.5) * 25 + 10;
    const jitter = Math.random() * 15;
    await sleep(baseDelay + jitter);
  }
}

// ============================================
// 2. 真人级输入
// ============================================
async function humanType(page, sel, text) {
  const el = await page.$(sel);
  const box = await el.boundingBox();
  await realisticMouseMove(page, 700, 400, box.x + 50 + Math.random() * 100, box.y + box.height / 2 + Math.random() * 5, 1500);
  await sleep(300);
  await page.mouse.click(box.x + 50, box.y + box.height / 2);
  await sleep(500);
  for (let i = 0; i < text.length; i++) {
    await page.keyboard.type(text[i], { delay: 100 + Math.random() * 200 });
  }
  await sleep(500);
}

// ============================================
// 3. 主页
// ============================================
(async () => {
  // 用户参数
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: node 126_e2e_protocol_login.js <username> <password> [headless=true]');
    console.log('  username: 京东账号（手机/邮箱）');
    console.log('  password: 密码');
    console.log('  headless: true=无头模式, false=有头模式（看得到 jcap 弹窗，推荐用 false 手动过 jcap）');
    process.exit(1);
  }
  const username = args[0];
  const password = args[1];
  const headlessMode = args[2] === 'false' ? false : 'new';

  console.log(`[126] 端到端协议化京东登录`);
  console.log(`  用户名: ${username}`);
  console.log(`  模式: headless=${headlessMode === false ? 'headed (用户手动过 jcap)' : 'new headless'}`);

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome',
    headless: headlessMode,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--window-size=1366,768',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

  // stealth
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    window.chrome = {
      app: { isInstalled: false, InstallState: {}, RunningState: {} },
      runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, connect: () => {}, sendMessage: () => {} },
      loadTimes: () => ({}),
      csi: () => ({}),
    };
  });

  // CDP 网络监控
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  const apiCalls = [];   // 所有 jcap /api/ 请求
  const apiResponses = []; // 所有 jcap /api/ 响应
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('/cgi-bin/api/')) {
      apiCalls.push({ requestId: e.requestId, url: e.request.url, postData: e.request.postData || '', t: Date.now() });
    }
  });
  cdp.on('Network.loadingFinished', async (e) => {
    const r = apiCalls.find(r => r.requestId === e.requestId);
    if (!r) return;
    try {
      const resp = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
      r.body = resp.body || '';
      apiResponses.push(r);
    } catch (err) {}
  });
  cdp.on('Network.responseReceived', async (e) => {
    // 抓 set-cookie 头
    if (e.request.url.includes('passport.jd.com')) {
      const hdrs = e.response.headers || {};
      if (hdrs['set-cookie']) {
        // console.log('[set-cookie]', hdrs['set-cookie']);
      }
    }
  });

  // ============================================
  // 步骤 1: 打开登录页热身
  // ============================================
  console.log('\n[1] 访问京东首页热身...');
  await page.goto('https://www.jd.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(100 + Math.random() * 1100, 100 + Math.random() * 500, { steps: 10 });
    await sleep(300 + Math.random() * 500);
  }
  await page.evaluate(() => window.scrollTo(0, 100 + Math.random() * 300));
  await sleep(1000);

  // ============================================
  // 步骤 2: 打开登录页
  // ============================================
  console.log('[2] 访问登录页...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);

  // 抓 form 隐藏字段
  const form = await page.evaluate(() => ({
    uuid: $('#uuid').val(),
    eid: $('#eid').val(),
    fp: $('#sessionId').val(),
    eid2: $('#eid2').val(),
    token: $('#token').val(),
    loginType: $('#loginType').val(),
    pubKey: $('#pubKey').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    firstShowAccountLoginPage: $('#firstShowAccountLoginPage').val(),
    sa_token: $('#sa_token').val(),
    expgroup: $('#expgroup').val(),
    pageSource: $('#pageSource').val(),
    pageLocation: $('#pageLocation').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val(),
  }));
  console.log('  form 字段:');
  console.log(`    uuid=${form.uuid?.substring(0, 16)}...`);
  console.log(`    eid=${form.eid?.substring(0, 16)}...`);
  console.log(`    fp=${form.fp?.substring(0, 16)}...`);
  console.log(`    sa_token=${form.sa_token?.substring(0, 20)}...`);
  console.log(`    pubKey=${form.pubKey?.substring(0, 30)}...`);

  // ============================================
  // 步骤 3: 输入账号密码（RSA 加密）
  // ============================================
  console.log('\n[3] 输入账号密码 + RSA 加密...');
  await humanType(page, '#loginname', username);
  await humanType(page, '#nloginpwd', password);

  // 在 page context 内 RSA 加密密码
  const nloginpwd = await page.evaluate((pubKey, pwd) => {
    const c = new JSEncrypt();
    c.setPublicKey(pubKey);
    return c.encrypt(pwd);
  }, form.pubKey, password);
  console.log(`  nloginpwd: ${nloginpwd?.substring(0, 50)}... (${nloginpwd?.length} chars)`);

  // ============================================
  // 步骤 4: 触发 jcap（多次点击登录）
  // ============================================
  console.log('\n[4] 触发 jcap（多次点击登录）...');
  const btnEl = await page.$('.login-btn');
  const btnBox = await btnEl.boundingBox();

  for (let i = 1; i <= 4; i++) {
    await realisticMouseMove(page, 600, 500, btnBox.x + btnBox.width / 2 + (Math.random() - 0.5) * 30, btnBox.y + btnBox.height / 2 + (Math.random() - 0.5) * 5, 1500);
    await sleep(300);
    await page.mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
    await sleep(3000);
    const hasModal = await page.evaluate(() => !!document.querySelector('#captcha_modal, .captcha_modal_pc'));
    if (hasModal) {
      console.log(`  第 ${i} 次点击触发 jcap 弹窗`);
      break;
    }
  }

  // ============================================
  // 步骤 5: 等待用户手动过 jcap
  // ============================================
  console.log('\n[5] 等待用户手动通过 jcap 验证...');
  if (headlessMode === false) {
    console.log('  ⏳ 浏览器已打开可见窗口，请手动操作 jcap 弹窗（拖动 / 画线 / 旋转）');
    console.log('  ⏳ 等待 90 秒...');
  } else {
    console.log('  ⏳ headless 模式下无法手动操作，请用 headed 模式重跑（headless=false）');
    console.log('  ⏳ 仍然等待 90 秒尝试捕获服务端响应...');
  }

  // 监控 /api/check 响应，找 vt
  let capturedVT = null;
  let capturedST = null;
  let capturedFP = null;
  let checkResponses = [];
  const startTime = Date.now();
  const maxWaitMs = process.env.DRY_RUN ? 20000 : 90000;

  while (Date.now() - startTime < maxWaitMs) {
    // 检查是否出现新 /api/check 响应且 code=0 且有 vt
    for (const r of apiResponses) {
      if (r.url.includes('/check') && r.body && !checkResponses.includes(r)) {
        checkResponses.push(r);
        try {
          const j = JSON.parse(r.body);
          console.log(`  [${new Date(r.t).toISOString().slice(11, 19)}] /api/check: code=${j.code} tp=${j.tp} vt=${j.vt ? j.vt.substring(0, 30) + '...' : 'null'}`);
          if (j.code === 0 && j.vt) {
            capturedVT = j.vt;
            capturedST = j.st;
            console.log('\n  ✅ 拿到 vt token！');
            console.log(`  vt: ${j.vt.substring(0, 50)}...`);
            console.log(`  st: ${j.st}`);
            break;
          }
        } catch (e) {}
      }
    }
    if (capturedVT) break;
    await sleep(1000);
  }

  if (!capturedVT) {
    console.log('\n  ❌ 90 秒内未拿到 vt token');
    console.log('  所有 /api/ 响应:');
    for (const r of apiCalls) {
      if (r.body) {
        const ep = r.url.split('/').slice(-2).join('/');
        console.log(`    ${ep}: ${r.body.substring(0, 200)}`);
      }
    }
    await browser.close();
    process.exit(1);
  }

  // 抓最新的 fp（拿 vt 时的 fp 可能是新生成的）
  for (let i = apiResponses.length - 1; i >= 0; i--) {
    if (apiResponses[i].url.includes('/fp') && apiResponses[i].body) {
      try {
        const j = JSON.parse(apiResponses[i].body);
        if (j.fp) {
          capturedFP = j.fp;
          console.log(`  fp: ${j.fp.substring(0, 50)}...`);
          break;
        }
      } catch (e) {}
    }
  }

  // ============================================
  // 步骤 6: 协议化 loginService
  // ============================================
  console.log('\n[6] 协议化 loginService POST（22 字段）...');

  // 重新抓一次 form 字段（页面状态可能已更新）
  const form2 = await page.evaluate(() => ({
    uuid: $('#uuid').val(),
    eid: $('#eid').val(),
    fp: $('#sessionId').val(),
    eid2: $('#eid2').val(),
    token: $('#token').val(),
    loginType: $('#loginType').val(),
    pubKey: $('#pubKey').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    firstShowAccountLoginPage: $('#firstShowAccountLoginPage').val(),
    sa_token: $('#sa_token').val(),
    expgroup: $('#expgroup').val(),
    pageSource: $('#pageSource').val(),
    pageLocation: $('#pageLocation').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val(),
  }));

  // 在 page context 内构造 + POST loginService（h5st 由页面内 paramsign 自动算）
  const loginResult = await page.evaluate(async (form, nloginpwd, vt, st, fp) => {
    const data = new URLSearchParams();
    data.append('uuid', form.uuid);
    data.append('eid', form.eid);
    data.append('fp', form.fp);
    data.append('eid2', form.eid2);
    data.append('_t', form.token);
    data.append('loginType', form.loginType);
    data.append('loginname', $('#loginname').val());
    data.append('nloginpwd', nloginpwd);
    data.append('authcode', '');
    data.append('pubKey', form.pubKey);
    data.append('sa_token', form.sa_token);
    data.append('seqSid', window._jdtdmap_sessionId || '');
    data.append('useSlideAuthCode', form.useSlideAuthCode);
    data.append('pageSource', form.pageSource);
    data.append('pageLocation', form.pageLocation);
    data.append('firstShowAccountLoginPage', form.firstShowAccountLoginPage);
    data.append('ssoDomains', '');
    data.append('expgroup', form.expgroup);
    // 关键: 注入 jcap vt + st + fp
    if (vt) data.append('verifycode', vt);
    if (st) data.append('st', st);
    if (fp) data.append('jcap_fp', fp);
    if (form.graphicCaptchaSessionId) data.append('graphicCaptchaSessionId', form.graphicCaptchaSessionId);
    if (form.graphicCaptchaJwtToken) data.append('graphicCaptchaJwtToken', form.graphicCaptchaJwtToken);

    const r = await fetch(`/uc/loginService?r=${Math.random()}&version=2015`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Referer: 'https://passport.jd.com/uc/login',
      },
      body: data.toString(),
    });
    const text = await r.text();
    return { status: r.status, text, cookies: document.cookie };
  }, form2, nloginpwd, capturedVT, capturedST, capturedFP);

  console.log(`  loginService 响应 status=${loginResult.status}`);
  console.log(`  body: ${loginResult.text.substring(0, 500)}`);

  // 解析响应
  let loginJson = null;
  try { loginJson = JSON.parse(loginResult.text.replace(/^\(|\)$/g, '')); } catch (e) {}

  if (loginJson) {
    console.log('\n  === 登录响应 ===');
    console.log(`  ${JSON.stringify(loginJson, null, 2).substring(0, 1000)}`);
  }

  // ============================================
  // 步骤 7: 提取 cookie（pt_key, pt_pin, pt_token）
  // ============================================
  console.log('\n[7] 提取 pt_key / pt_pin cookie...');
  const allCookies = await page.cookies();
  const ptKey = allCookies.find(c => c.name === 'pt_key');
  const ptPin = allCookies.find(c => c.name === 'pt_pin');
  const ptToken = allCookies.find(c => c.name === 'pt_token');

  console.log(`  pt_key: ${ptKey ? ptKey.value.substring(0, 50) + '...' : 'NOT SET'}`);
  console.log(`  pt_pin: ${ptPin ? ptPin.value : 'NOT SET'}`);
  console.log(`  pt_token: ${ptToken ? ptToken.value.substring(0, 50) + '...' : 'NOT SET'}`);

  if (ptKey && ptPin) {
    console.log('\n🎉 协议化登录成功！');
    const cookieStr = `pt_key=${ptKey.value};pt_pin=${ptPin.value};${ptToken ? 'pt_token=' + ptToken.value + ';' : ''}`.replace(/;$/, '');
    console.log(`\nCookie 串（可复制使用）:\n${cookieStr}`);

    // 保存到文件
    fs.writeFileSync('/tmp/jd_login_success.json', JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      username,
      cookies: { pt_key: ptKey.value, pt_pin: ptPin.value, pt_token: ptToken?.value },
      cookieStr,
      loginResponse: loginJson,
    }, null, 2));
    console.log('\n  已保存到 /tmp/jd_login_success.json');
  } else {
    console.log('\n  ❌ 登录失败，未拿到 pt_key/pt_pin');
    console.log('  可能原因:');
    console.log('  1. 账号/密码错误');
    console.log('  2. 触发了二次验证 (newSafeVerify)');
    console.log('  3. 风控限制 (rescue)');
    console.log('  4. vt 失效（每个 vt 一次性使用）');
  }

  await browser.close();
})();
