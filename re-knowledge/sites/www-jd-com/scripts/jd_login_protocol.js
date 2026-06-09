/**
 * 京东完整协议化登录模块（端到端可执行版）
 * =========================================
 *
 * 关键设计：
 *   1. 浏览器侧只做"用户介入过 jcap"（一次性手动操作 - 绕过服务端 ML）
 *   2. 拿到 vt 后，**协议化构造 22 字段 POST body** + 调用 loginService
 *   3. 提取 pt_key/pt_pin cookie + 输出可重用的 cookie 串
 *
 * 模块清单:
 *   1. h5st 5.3 协议还原 (Phase 1)
 *   2. RSA 1024-bit 密码加密 (Phase 2)
 *   3. jdSlide 滑块 d 参数算法 (Phase 4) - 已完整还原
 *   4. jcap 验证码分析 (Phase 3) - 服务端 ML 检测无法用 puppeteer 自动化绕过
 *   5. loginService 协议化 (Phase 5) - 22 字段 POST body
 *
 * 用法:
 *   const { JDLogin } = require('./jd_login_protocol');
 *   const jd = new JDLogin({ headless: false });  // 必须 false 看到 jcap 弹窗
 *   const result = await jd.login({ username, password });
 *   console.log(result.cookieStr);
 *
 * 用户操作流程（一次性手动过 jcap）:
 *   1. 启动脚本，浏览器打开登录页
 *   2. 脚本自动输入账号密码 + 触发 jcap 弹窗
 *   3. 看到 jcap 弹窗 → 用户手动拖动 / 画线 / 旋转
 *   4. jcap 通过 → 脚本自动捕获 vt
 *   5. 脚本协议化 loginService → 拿 pt_key/pt_pin
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

puppeteer.use(StealthPlugin());

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================
// 1. h5st 5.3 协议还原模块
// ============================================
const H5ST_5_3 = {
  algorithm: 'CryptoJS.HmacSHA256 + ParamsSign',
  version: '5.3',
  fields: {
    t: 'token 1 (tk1)',
    s: 'token 2 (tk2)',
    f: 'function name',
    appId: 'appId',
    ts: 'timestamp (ms)',
    body: 'business data (signed)',
  },
  signH5st: function(token, content) {
    const CryptoJS = require('crypto-js');
    return CryptoJS.HmacSHA256(content, token).toString();
  },
};

// ============================================
// 2. RSA 1024-bit 密码加密
// ============================================
const RSA_PWD_ENC = {
  algorithm: 'RSA 1024-bit PKCS#1 v1.5',
  library: 'jsencrypt',
  publicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCUkSA1JEO8dzSX5SYaiTO7yhGoIvR1lL1iY4klAz6XdqJ3NVlDtHF9txMFOSwoRZVjPaCft0yYAV3zJafEMRp+XeLNvDm6ZmozDsi7LuJvbvDZusUtoL1L+OoCkpVUuYZzW0ZeQrJ3DdtxsIFDN7B/2PogwETA4KzVA8XcGhlQIDAQAB',
  encrypt: function(plaintext) {
    if (plaintext.length > 117) {
      throw new Error('password too long, max 117 bytes');
    }
    const JSEncrypt = require('jsencrypt');
    const c = new JSEncrypt();
    c.setPublicKey(this.publicKey);
    return c.encrypt(plaintext);
  },
};

// ============================================
// 3. jcap 验证码 (服务端 ML 检测)
// ============================================
const JCAP_2_8_5 = {
  algorithm: '行为验证 + WASM 加密',
  version: 'v2.8.5',
  domain: 'jcap.m.jd.com',
  interfaces: {
    fp: { interfaceId: 268435458, name: 'fp' },
    check: { interfaceId: 268435460, name: 'check' },
    verify: { interfaceId: 268435462, name: 'verify' },
  },
  // 验证流程: /api/fp → /api/check (返回 vt) → /api/refresh
  // vt 是 jcap 验证通过后的 token, 用于 loginService
  // 服务端 ML 检测 16807 = 验证失败
  // 绕过: 用户在本机真实 Chrome 手动操作绕过 ML
  requires_browser: true,
  bypass_strategy: '用户手动介入 + 协议化 loginService',
};

// ============================================
// 4. jdSlide d 参数算法 (已完整还原)
// ============================================
const JDSLIDE_D = {
  algorithm: 'Base64 自定义字符集 + 差分编码',
  version: 'v6.1.2',
  CHARS_64: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-~',

  string10to64: function(n) {
    let num = Number(n);
    const c = this.CHARS_64.length;
    const e = [];
    do {
      const mod = num % c;
      num = (num - mod) / c;
      e.unshift(this.CHARS_64[mod]);
    } while (num);
    return e.join('');
  },

  prefixInteger: function(a, b) {
    return ('0'.repeat(b) + a).slice(-b);
  },

  pretreatment: function(a, b, isFirst) {
    const numA = Number(a);
    const e = this.string10to64(Math.abs(numA));
    let f = '';
    if (!isFirst) {
      f += numA > 0 ? '1' : '0';
    }
    f += this.prefixInteger(e, b);
    return f;
  },

  getCoordinate: function(mousePos) {
    const c = [];
    for (let d = 0; d < mousePos.length; d++) {
      if (d === 0) {
        c.push(this.pretreatment(Math.min(mousePos[d][0], 0x3ffff), 3, true));
        c.push(this.pretreatment(Math.min(mousePos[d][1], 0xffffff), 4, true));
        c.push(this.pretreatment(Math.min(mousePos[d][2], 0x3ffffffffff), 7, true));
      } else {
        const dx = mousePos[d][0] - mousePos[d - 1][0];
        const dy = mousePos[d][1] - mousePos[d - 1][1];
        const dt = mousePos[d][2] - mousePos[d - 1][2];
        c.push(this.pretreatment(Math.min(dx, 0xfff), 2, false));
        c.push(this.pretreatment(Math.min(dy, 0xfff), 2, false));
        c.push(this.pretreatment(Math.min(dt, 0xffffff), 4, true));
      }
    }
    return c.join('');
  },
};

// ============================================
// 5. 缺口识别 (OpenCV 模板匹配)
// ============================================
function gapDetect(bgPath, patchPath) {
  const { spawnSync } = require('child_process');
  const script = path.join(__dirname, 'jd_slide_fulldemo.py');
  const r = spawnSync('python3', [script, bgPath, patchPath], { encoding: 'utf-8' });
  const m = r.stdout.match(/缺口 x = (\d+)/);
  return m ? parseInt(m[1]) : -1;
}

// ============================================
// 6. 真实人行为轨迹生成
// ============================================
function generateTrajectory(targetX, startT, totalMs = 1500) {
  const points = [];
  const nSteps = 52;
  points.push([0, 0, startT]);
  let cx = 0;
  let ct = 0;
  for (let i = 1; i < nSteps; i++) {
    const t = i / nSteps;
    const eased = 1 - Math.pow(1 - t, 2.5);
    const jitter = Math.random() * 2 - 1;
    const yJitter = [0, 0, 0, 1, -1, 1, 2, -1][Math.floor(Math.random() * 8)];
    const dt = 15 + Math.floor(Math.random() * 35);
    ct += dt;
    let x = Math.round(eased * targetX + jitter);
    if (x < cx) x = cx + 1;
    cx = x;
    points.push([x, yJitter, startT + ct]);
  }
  points.push([targetX, 0, startT + totalMs]);
  return points;
}

// ============================================
// 7. loginService 协议化 (22 字段)
// ============================================
const LOGIN_SERVICE = {
  url: 'https://passport.jd.com/uc/loginService',
  method: 'POST',
  contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
  fields: [
    'uuid', 'eid', 'fp', 'eid2', '_t', 'loginType', 'loginname', 'nloginpwd',
    'authcode', 'pubKey', 'sa_token', 'seqSid', 'useSlideAuthCode',
    'pageSource', 'pageLocation', 'firstShowAccountLoginPage', 'ssoDomains',
    'expgroup', 'graphicCaptchaSessionId', 'graphicCaptchaJwtToken',
    'verifycode (jcap vt)', 'st (jcap st)', 'jcap_fp (jcap fp)',
  ],
};

// ============================================
// 8. JDLogin 主类 - 端到端协议化登录
// ============================================
class JDLogin {
  constructor(options = {}) {
    // Chrome 路径自动检测: 优先环境变量，其次 puppeteer 默认下载位置
    this.executablePath = options.executablePath || process.env.CHROME_PATH || null;
    this.headless = options.headless !== undefined ? options.headless : false;  // 默认 false 让用户能手动过 jcap
    this.useStealth = options.useStealth !== false;
    this.jcapTimeoutMs = options.jcapTimeoutMs || 90000;  // 等用户手动过 jcap 的超时
  }

  /**
   * 端到端协议化京东登录
   * @param {Object} options
   * @param {string} options.username - 京东账号（手机/邮箱）
   * @param {string} options.password - 密码
   * @returns {Promise<{success, cookies, cookieStr, validate, message}>}
   */
  async login(options) {
    const { username, password } = options;
    if (!username || !password) {
      throw new Error('username and password required');
    }

    console.log(`[JDLogin] 端到端协议化登录: ${username}`);
    console.log(`[JDLogin] headless=${this.headless} stealth=${this.useStealth}`);

    const launchOptions = {
      headless: this.headless === true ? 'new' : this.headless,  // true→'new', false→headed
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,768',
      ],
      defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
    };
    if (this.executablePath) {
      launchOptions.executablePath = this.executablePath;
    }

    const browser = await puppeteer.launch(launchOptions);
    try {
      const result = await this._e2eFlow(browser, username, password);
      return result;
    } finally {
      await browser.close();
    }
  }

  /**
   * 端到端流程：
   *   1. 打开登录页 + 抓 form 字段
   *   2. 输入账号密码 + RSA 加密
   *   3. 触发 jcap（多次点击登录）
   *   4. **等用户手动过 jcap**（CDP 监控 /api/check 捕获 vt）
   *   5. 协议化 loginService（22 字段 POST body + vt）
   *   6. 提取 pt_key/pt_pin cookie
   */
  async _e2eFlow(browser, username, password) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

    if (this.useStealth) {
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
    }

    // CDP 网络监控
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');
    const apiResponses = [];
    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.request.url.includes('/cgi-bin/api/')) {
        apiResponses.push({ requestId: e.requestId, url: e.request.url, t: Date.now() });
      }
    });
    cdp.on('Network.loadingFinished', async (e) => {
      const r = apiResponses.find(r => r.requestId === e.requestId);
      if (!r) return;
      try {
        const resp = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
        r.body = resp.body || '';
      } catch (err) {}
    });

    // ============================================
    // 步骤 1: 首页热身
    // ============================================
    console.log('[1/7] 首页热身...');
    await page.goto('https://www.jd.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(100 + Math.random() * 1100, 100 + Math.random() * 500, { steps: 10 });
      await sleep(300 + Math.random() * 500);
    }

    // ============================================
    // 步骤 2: 登录页 + 抓 form 字段
    // ============================================
    console.log('[2/7] 打开登录页抓 form 字段...');
    await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    const form = await this._captureForm(page);
    console.log(`  uuid=${form.uuid?.substring(0, 16)}... eid=${form.eid?.substring(0, 16)}...`);
    console.log(`  sa_token=${form.sa_token?.substring(0, 20)}...`);

    // ============================================
    // 步骤 3: 输入账号密码 + RSA 加密
    // ============================================
    console.log('[3/7] 输入账号密码 + RSA 加密...');
    await this._humanType(page, '#loginname', username);
    await this._humanType(page, '#nloginpwd', password);

    const nloginpwd = await page.evaluate((pubKey, pwd) => {
      const c = new JSEncrypt();
      c.setPublicKey(pubKey);
      return c.encrypt(pwd);
    }, form.pubKey, password);
    console.log(`  nloginpwd: ${nloginpwd?.substring(0, 50)}... (${nloginpwd?.length} chars)`);

    // ============================================
    // 步骤 4: 触发 jcap
    // ============================================
    console.log('[4/7] 触发 jcap...');
    const btnEl = await page.$('.login-btn');
    const btnBox = await btnEl.boundingBox();
    for (let i = 1; i <= 4; i++) {
      await page.mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
      await sleep(3000);
      const hasModal = await page.evaluate(() => !!document.querySelector('#captcha_modal, .captcha_modal_pc'));
      if (hasModal) {
        console.log(`  ✅ 第 ${i} 次点击触发 jcap 弹窗`);
        break;
      }
    }

    // ============================================
    // 步骤 5: 等用户手动过 jcap（CDP 监控 /api/check 捕获 vt）
    // ============================================
    console.log('[5/7] 等待用户手动通过 jcap...');
    if (this.headless !== 'new') {
      console.log('  ⏳ 浏览器已打开可见窗口，请手动操作 jcap 弹窗');
    } else {
      console.log('  ⏳ headless 模式无 X server，请用 headed 模式重跑（new JDLogin({ headless: false })）');
    }

    const captcha = await this._waitForCaptchaVT(page, apiResponses, this.jcapTimeoutMs);
    if (!captcha.vt) {
      console.log('  ❌ 超时未拿到 vt token');
      return { success: false, message: 'jcap timeout: no vt captured', cookies: null, cookieStr: null };
    }
    console.log(`  ✅ 拿到 vt: ${captcha.vt.substring(0, 30)}...`);
    console.log(`     st: ${captcha.st}`);
    console.log(`     fp: ${captcha.fp?.substring(0, 30)}...`);

    // ============================================
    // 步骤 6: 协议化 loginService
    // ============================================
    console.log('[6/7] 协议化 loginService POST（22 字段）...');

    // 重新抓一次 form 字段（页面状态可能更新）
    const form2 = await this._captureForm(page);
    const loginResult = await this._protocolLoginService(page, form2, nloginpwd, username, captcha);
    console.log(`  loginService 响应: ${loginResult.text?.substring(0, 300)}`);

    // ============================================
    // 步骤 7: 提取 cookie
    // ============================================
    console.log('[7/7] 提取 pt_key / pt_pin cookie...');
    const cookies = await page.cookies();
    const ptKey = cookies.find(c => c.name === 'pt_key');
    const ptPin = cookies.find(c => c.name === 'pt_pin');
    const ptToken = cookies.find(c => c.name === 'pt_token');

    if (ptKey && ptPin) {
      const cookieStr = `pt_key=${ptKey.value};pt_pin=${ptPin.value};${ptToken ? 'pt_token=' + ptToken.value + ';' : ''}`.replace(/;$/, '');
      console.log(`\n🎉 协议化登录成功！`);
      console.log(`  pt_key: ${ptKey.value.substring(0, 50)}...`);
      console.log(`  pt_pin: ${ptPin.value}`);
      console.log(`  Cookie 串: ${cookieStr}`);
      return { success: true, cookies: { pt_key: ptKey.value, pt_pin: ptPin.value, pt_token: ptToken?.value }, cookieStr, validate: captcha.vt };
    } else {
      console.log('  ❌ 未拿到 pt_key/pt_pin');
      console.log(`  所有 cookies: ${cookies.map(c => c.name).join(', ')}`);
      return { success: false, message: 'no pt_key/pt_pin cookie', cookies: null, cookieStr: null, loginResponse: loginResult.text };
    }
  }

  async _captureForm(page) {
    return page.evaluate(() => ({
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
  }

  async _humanType(page, sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    await page.mouse.click(box.x + 50, box.y + box.height / 2);
    await sleep(300);
    for (let i = 0; i < text.length; i++) {
      await page.keyboard.type(text[i], { delay: 80 + Math.random() * 120 });
    }
    await sleep(500);
  }

  /**
   * 等用户手动过 jcap，捕获 vt token
   * 监控 /api/check 响应，code=0 且有 vt 表示通过
   */
  async _waitForCaptchaVT(page, apiResponses, timeoutMs) {
    const startTime = Date.now();
    const seen = new Set();
    while (Date.now() - startTime < timeoutMs) {
      for (const r of apiResponses) {
        if (r.body && !seen.has(r.requestId) && r.url.includes('/check')) {
          seen.add(r.requestId);
          try {
            const j = JSON.parse(r.body);
            const time = new Date(r.t).toISOString().slice(11, 19);
            console.log(`  [${time}] /api/check: code=${j.code} tp=${j.tp} vt=${j.vt ? 'YES' : 'null'}`);
            if (j.code === 0 && j.vt) {
              // 找最新的 fp
              let fp = null;
              for (let i = apiResponses.length - 1; i >= 0; i--) {
                if (apiResponses[i].url.includes('/fp') && apiResponses[i].body) {
                  try {
                    const fpj = JSON.parse(apiResponses[i].body);
                    if (fpj.fp) { fp = fpj.fp; break; }
                  } catch (e) {}
                }
              }
              return { vt: j.vt, st: j.st, fp };
            }
          } catch (e) {}
        }
      }
      await sleep(1000);
    }
    return { vt: null, st: null, fp: null };
  }

  /**
   * 协议化 loginService POST（22 字段）
   * 在 page context 内执行，使用真实的 h5st + eid + sa_token 等
   */
  async _protocolLoginService(page, form, nloginpwd, username, captcha) {
    return page.evaluate(async (form, nloginpwd, username, captcha) => {
      const data = new URLSearchParams();
      data.append('uuid', form.uuid);
      data.append('eid', form.eid);
      data.append('fp', form.fp);
      data.append('eid2', form.eid2);
      data.append('_t', form.token);
      data.append('loginType', form.loginType);
      data.append('loginname', $('#loginname').val() || username);
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
      if (captcha.vt) data.append('verifycode', captcha.vt);
      if (captcha.st) data.append('st', captcha.st);
      if (captcha.fp) data.append('jcap_fp', captcha.fp);
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
    }, form, nloginpwd, username, captcha);
  }
}

// ============================================
// Exports
// ============================================
module.exports = {
  JDLogin,
  H5ST_5_3,
  RSA_PWD_ENC,
  JCAP_2_8_5,
  JDSLIDE_D,
  gapDetect,
  generateTrajectory,
  LOGIN_SERVICE,
  PROJECT_ROOT,
};
