/**
 * 阶段3-4-5 协议化登录完整流程
 *
 * 目标：在 Node.js 中不依赖浏览器，完整模拟京东登录流程：
 *   1. 打开 passport.jd.com 拿 form 字段（uuid/eid/fp/sa_token/pubKey/...）
 *   2. 调 jcap.fp 拿 fingerprint
 *   3. 调 jcap.check 拿 session token (st) + tp
 *   4. 如果 tp:9 (不需图片) → POST /uc/loginService
 *   5. 如果 tp:30 (需图片) → 拿到 base64 jpg 验证码，需要人工或 OCR
 *   6. 调 jcap.verify 用 vt (verifyToken)
 *   7. 用滑块 jdSlide (ivs.jd.com) 拿 w
 *   8. POST /uc/loginService 带 vt + w
 *   9. 拿 set-cookie 中的 pt_key + pt_pin
 *
 * 用法: node 15_login_protocol.js
 *
 * 注意：需要测试京东账号；本文档假设用户名 = TEST_USER, 密码 = TEST_PASS
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const querystring = require('querystring');
const JSEncrypt = require('jsencrypt').default || require('jsencrypt');

// ========================== 配置 ==========================
const PUB_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDC7kw8r6tq43pwApYvkJ5laljaN9BZb21TAIfT/vexbobzH7Q8SUdP5uDPXEBKzOjx2L28y7Xs1d9v3tdPfKI2LR7PAzWBmDMn8riHrDDNpUpJnlAGUqJG9ooPn8j7YNpcxCa1iybOlc2kEhmJn5uwoanQq+CA6agNkqly2H4j6wIDAQAB';

// 从环境变量读账号（不要硬编码！）
const USERNAME = process.env.JD_USER || 'test_user_12345';
const PASSWORD = process.env.JD_PASS || 'TestPwd123!';

// ========================== 工具函数 ==========================
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'sec-ch-ua': '"Chromium";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': options.method === 'POST' ? 'empty' : 'document',
        'sec-fetch-mode': options.method === 'POST' ? 'cors' : 'navigate',
        'sec-fetch-site': 'same-origin',
        ...options.headers,
      },
      ...options,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          setCookie: res.headers['set-cookie'] || [],
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseSetCookie(setCookieHeaders) {
  const jar = {};
  for (const sc of setCookieHeaders) {
    const [pair] = sc.split(';');
    const [k, v] = pair.split('=');
    if (k && v) jar[k.trim()] = v.trim();
  }
  return jar;
}

function getCookiesStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ========================== RSA 密码加密 ==========================
function encryptPassword(plain) {
  const crypt = new JSEncrypt();
  crypt.setPublicKey(PUB_KEY);
  const r = crypt.encrypt(plain);
  if (!r) throw new Error('RSA encrypt returned null');
  return r;
}

// ========================== 阶段 1: 拿 form 字段 ==========================
async function fetchLoginForm() {
  console.log('[1] 打开 passport.jd.com 拿 form 字段...');
  const resp = await request('https://passport.jd.com/uc/login', {
    headers: { 'Upgrade-Insecure-Requests': '1', Referer: '' },
  });
  if (resp.status !== 200) throw new Error(`login page status ${resp.status}`);

  const html = resp.body;
  // 提取关键字段
  const grab = (id) => {
    const m = new RegExp(`id="${id}"[^>]*value="([^"]*)"`, 'i').exec(html) ||
               new RegExp(`id="${id}"[^>]*value='([^']*)'`, 'i').exec(html);
    return m ? m[1] : null;
  };

  const fields = {
    uuid: grab('uuid'),
    eid: grab('eid'),
    sessionId: grab('sessionId'),  // fp
    eid2: grab('eid2'),
    token: grab('token'),
    loginType: grab('loginType'),
    main_flag: grab('main_flag'),
    pubKey: grab('pubKey'),
    slideAppId: grab('slideAppId'),
    useSlideAuthCode: grab('useSlideAuthCode'),
    useRandomSlideAuthCode: grab('useRandomSlideAuthCode'),
    firstShowAccountLoginPage: grab('firstShowAccountLoginPage'),
    graphicCaptchaStatus: grab('graphicCaptchaStatus'),
    graphicCaptchaAppId: grab('graphicCaptchaAppId'),
    graphicCaptchaSessionId: grab('graphicCaptchaSessionId'),
    graphicCaptchaJwtToken: grab('graphicCaptchaJwtToken'),
    sa_token: grab('sa_token'),
    expgroup: grab('expgroup'),
  };

  console.log('  uuid =', fields.uuid);
  console.log('  eid =', fields.eid?.slice(0, 30) + '...');
  console.log('  fp (sessionId) =', fields.sessionId);
  console.log('  eid2 =', fields.eid2?.slice(0, 50) + '...');
  console.log('  pubKey =', fields.pubKey?.slice(0, 30) + '...');
  console.log('  useSlideAuthCode =', fields.useSlideAuthCode);
  console.log('  graphicCaptchaStatus =', fields.graphicCaptchaStatus);
  console.log('  graphicCaptchaAppId =', fields.graphicCaptchaAppId);
  console.log('  sa_token =', fields.sa_token?.slice(0, 30) + '...', `(${fields.sa_token?.length} chars)`);

  return { fields, cookies: parseSetCookie(resp.setCookie) };
}

// ========================== 阶段 2: jcap fp ==========================
async function callJcapFp(cookies) {
  console.log('\n[2] jcap.fp 拿 fingerprint...');
  // POST https://jcap.m.jd.com/cgi-bin/api/fp
  // body 较长，浏览器实测是一些浏览器指纹
  // 这里简化：直接 fetch
  const resp = await request('https://jcap.m.jd.com/cgi-bin/api/fp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://passport.jd.com/',
      Cookie: getCookiesStr(cookies),
    },
    body: 'si=&ct=&fp=',  // 简化，实际 browser 中带大量指纹
  });
  console.log('  status:', resp.status);
  console.log('  body:', resp.body?.slice(0, 300));
  try {
    return JSON.parse(resp.body);
  } catch (e) {
    return { raw: resp.body, status: resp.status };
  }
}

// ========================== 阶段 3: jcap check ==========================
async function callJcapCheck(cookies, st = '') {
  console.log('\n[3] jcap.check 拿 session st...');
  const resp = await request('https://jcap.m.jd.com/cgi-bin/api/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://passport.jd.com/',
      Cookie: getCookiesStr(cookies),
    },
    body: `si=&lang=1&tk=${st}&appId=1000803`,
  });
  console.log('  status:', resp.status);
  console.log('  body:', resp.body?.slice(0, 400));
  try {
    return JSON.parse(resp.body);
  } catch (e) {
    return { raw: resp.body };
  }
}

// ========================== 阶段 4: POST /uc/loginService ==========================
async function postLoginService(fields, cookies, extra = {}) {
  console.log('\n[4] POST /uc/loginService...');

  // 构造 POST body
  const data = {
    uuid: fields.uuid,
    eid: fields.eid,
    fp: fields.sessionId,
    eid2: fields.eid2,
    _t: fields.token,
    loginType: fields.loginType,
    loginname: USERNAME,
    nloginpwd: encryptPassword(PASSWORD),
    authcode: extra.authcode || '',
    pubKey: fields.pubKey,
    sa_token: fields.sa_token,
    seqSid: '',
    useSlideAuthCode: fields.useSlideAuthCode,
    pageSource: 'pageSource',
    pageLocation: 'pageLocation',
    firstShowAccountLoginPage: fields.firstShowAccountLoginPage,
    ssoDomains: '',
    ...extra,
  };

  const body = querystring.stringify(data);
  console.log('  body length:', body.length, 'chars');
  console.log('  nloginpwd (RSA encrypted):', data.nloginpwd.slice(0, 60) + '...', `(${data.nloginpwd.length} chars)`);
  console.log('  h5st: 缺 (需要 paramsSingUtils 签名 loginname)');
  console.log('  sa_token:', data.sa_token?.slice(0, 30) + '...');

  const resp = await request('https://passport.jd.com/uc/loginService?r=' + Math.random() + '&version=2015', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      Referer: 'https://passport.jd.com/uc/login',
      Cookie: getCookiesStr(cookies),
    },
    body,
  });

  console.log('\n  响应 status:', resp.status);
  console.log('  响应 body:', resp.body?.slice(0, 600));
  console.log('  set-cookie count:', resp.setCookie.length);
  for (const sc of resp.setCookie) {
    console.log('    ', sc.slice(0, 200));
  }

  return resp;
}

// ========================== 主流程 ==========================
async function main() {
  console.log('=== JD 协议化登录完整流程 ===\n');
  console.log('配置:');
  console.log('  USERNAME =', USERNAME);
  console.log('  PASSWORD =', '*'.repeat(PASSWORD.length));
  console.log('');

  try {
    // 阶段 1: 拿 form 字段
    const { fields, cookies } = await fetchLoginForm();
    const allCookies = { ...cookies };

    // 阶段 2: jcap fp
    const fpResp = await callJcapFp(allCookies);
    if (fpResp.st) allCookies['jcap_sid'] = fpResp.st;
    if (fpResp.fp) allCookies['jcap_fp'] = fpResp.fp;

    // 阶段 3: jcap check
    const checkResp = await callJcapCheck(allCookies, fpResp.st || '');
    if (checkResp.st) allCookies['jcap_sid'] = checkResp.st;

    console.log('\n[分析] jcap.check.tp =', checkResp.tp);
    if (checkResp.tp === 30) {
      console.log('  ⚠️  需要图片验证码，跳过自动登录');
      console.log('  流程：需要 jcap 拖动/输入后调用 jcap.verify 拿 vt');
      console.log('  当前 OCR/滑块协议化还原还未实现');
    } else if (checkResp.tp === 9) {
      console.log('  ✓ 不需图片验证码，可直接 POST /uc/loginService');
    }

    // 阶段 4: POST /uc/loginService（缺 h5st/vt/w）
    const loginResp = await postLoginService(fields, allCookies);

    console.log('\n[分析] 登录响应:');
    if (loginResp.body) {
      try {
        const obj = eval('(' + loginResp.body + ')');
        console.log('  success:', obj.success);
        console.log('  transfer:', obj.transfer);
        console.log('  rescue:', obj.rescue);
        console.log('  newSafeVerify:', obj.newSafeVerify);
        console.log('  username err:', obj.username);
        console.log('  pwd err:', obj.pwd);
        console.log('  emptyAuthcode:', obj.emptyAuthcode);
        console.log('  _t (new token):', obj._t?.slice(0, 30) + '...');
      } catch (e) {
        console.log('  (无法 eval，可能是加密响应)');
      }
    }
  } catch (e) {
    console.error('错误:', e.message);
    console.error(e.stack);
  }
}

main();
