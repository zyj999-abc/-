/**
 * 阶段3-4-5-6: 协议化登录完整流程（puppeteer 内执行）
 *
 * 关键：用浏览器 fetch 发出请求（避免 Node.js TLS 指纹被风控）
 *
 * 流程：
 *   1. 打开 passport.jd.com 拿 form 字段（含 RSA 公钥、sa_token、eid 等）
 *   2. RSA 加密密码 (nloginpwd)
 *   3. 调 jcap.fp 拿 fp + st
 *   4. 调 jcap.check 拿 st + tp
 *   5. POST /uc/loginService（无 h5st / 无 vt，看服务端怎么响应）
 *   6. 解析响应，看是返回 success 还是要求 jcap 滑块
 *   7. 如果返回 smartInitSlide 触发，调 jdSlide 拿 w，再 POST 一次
 *
 * 用法: node 16_full_login_browser.js
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

const USERNAME = process.env.JD_USER || 'test_user_12345';
const PASSWORD = process.env.JD_PASS || 'TestPwd123!';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--ignore-certificate-errors'],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

  // 拦截 api/cookie
  const apiLog = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/loginService|jcap|geetest|seq\.|cactus|jra|sgm-|ivs\.|gia\./.test(u)) {
      apiLog.push({
        method: req.method(),
        url: u,
        postData: req.postData()?.slice(0, 500),
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
          url: u,
          status: resp.status(),
          body: txt.slice(0, 1500),
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
    main_flag: $('#main_flag').val(),
    pubKey: $('#pubKey').val(),
    slideAppId: $('#slideAppId').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    useRandomSlideAuthCode: $('#useRandomSlideAuthCode').val(),
    firstShowAccountLoginPage: $('#firstShowAccountLoginPage').val(),
    graphicCaptchaStatus: $('#graphicCaptchaStatus').val(),
    graphicCaptchaAppId: $('#graphicCaptchaAppId').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val(),
    sa_token: $('#sa_token').val(),
    expgroup: $('#expgroup').val(),
  }));
  console.log('  form fields captured. uuid=' + form.uuid + ' eid=' + form.eid?.slice(0, 30) + '...');
  console.log('  graphicCaptchaStatus=' + form.graphicCaptchaStatus + ' useSlideAuthCode=' + form.useSlideAuthCode);
  console.log('  sa_token length: ' + form.sa_token?.length);

  // ===== 在浏览器内执行完整协议化登录 =====
  const loginResult = await page.evaluate(async (form, USERNAME, PASSWORD) => {
    // === 阶段 1: RSA 加密密码 ===
    const crypt = new JSEncrypt();
    crypt.setPublicKey(form.pubKey);
    const nloginpwd = crypt.encrypt(PASSWORD);
    if (!nloginpwd) return { err: 'RSA 加密失败' };

    // === 阶段 2: jcap fp ===
    const fpResp = await fetch('https://jcap.m.jd.com/cgi-bin/api/fp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://passport.jd.com/' },
      body: 'si=&ct=&fp=',
      credentials: 'include',
    });
    const fpData = await fpResp.json();

    // === 阶段 3: jcap check ===
    const checkResp = await fetch('https://jcap.m.jd.com/cgi-bin/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://passport.jd.com/' },
      body: `si=&lang=1&tk=${fpData.st || ''}&appId=1000803`,
      credentials: 'include',
    });
    const checkData = await checkResp.json();

    // === 阶段 4: 构造登录 POST body ===
    const data = new URLSearchParams();
    data.append('uuid', form.uuid);
    data.append('eid', form.eid);
    data.append('fp', form.fp);
    data.append('eid2', form.eid2);
    data.append('_t', form.token);
    data.append('loginType', form.loginType);
    data.append('loginname', USERNAME);
    data.append('nloginpwd', nloginpwd);
    data.append('authcode', '');
    data.append('pubKey', form.pubKey);
    data.append('sa_token', form.sa_token);
    data.append('seqSid', window._jdtdmap_sessionId || '');
    data.append('useSlideAuthCode', form.useSlideAuthCode);
    data.append('pageSource', $('#pageSource')?.val() || '');
    data.append('pageLocation', $('#pageLocation')?.val() || '');
    data.append('firstShowAccountLoginPage', form.firstShowAccountLoginPage);
    data.append('ssoDomains', '');
    // graphicCaptcha 字段
    if (form.graphicCaptchaSessionId) data.append('graphicCaptchaSessionId', form.graphicCaptchaSessionId);
    if (form.graphicCaptchaJwtToken) data.append('graphicCaptchaJwtToken', form.graphicCaptchaJwtToken);

    // h5st 暂不签，看服务端响应
    // data.append('h5st', '...');
    // data.append('_stk', '...');

    // === 阶段 5: POST /uc/loginService ===
    const loginResp = await fetch(`/uc/loginService?r=${Math.random()}&version=2015`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Referer: 'https://passport.jd.com/uc/login',
      },
      body: data.toString(),
      credentials: 'include',
    });
    const loginText = await loginResp.text();
    let loginObj = null;
    try { loginObj = eval('(' + loginText + ')'); } catch (e) {}

    return {
      fp: fpData,
      check: checkData,
      nloginpwd: nloginpwd.slice(0, 60) + '...',
      nloginpwdLen: nloginpwd.length,
      loginStatus: loginResp.status,
      loginBody: loginText.slice(0, 1500),
      loginObj: loginObj,
      cookies: document.cookie,
    };
  }, form, USERNAME, PASSWORD);

  console.log('\n=== 协议化登录结果 ===');
  console.log('[RSA] nloginpwd =', loginResult.nloginpwd, '(' + loginResult.nloginpwdLen + ' chars)');
  console.log('[jcap.fp] st=' + loginResult.fp.st + ' tp=' + loginResult.fp.tp + ' fp=' + loginResult.fp.fp?.slice(0, 30) + '...');
  console.log('[jcap.check] st=' + loginResult.check.st + ' tp=' + loginResult.check.tp);
  console.log('[loginService] status=' + loginResult.loginStatus);
  console.log('[loginService] body[0:600] =');
  console.log(loginResult.loginBody?.slice(0, 600));

  if (loginResult.loginObj) {
    console.log('\n[loginService] eval 对象:');
    console.log('  success:', loginResult.loginObj.success);
    console.log('  transfer:', loginResult.loginObj.transfer);
    console.log('  rescue:', loginResult.loginObj.rescue);
    console.log('  newSafeVerify:', loginResult.loginObj.newSafeVerify);
    console.log('  username:', loginResult.loginObj.username);
    console.log('  pwd:', loginResult.loginObj.pwd);
    console.log('  emptyAuthcode:', loginResult.loginObj.emptyAuthcode);
    console.log('  _t:', loginResult.loginObj._t?.slice(0, 30) + '...');
  }

  console.log('\n[cookies] ' + loginResult.cookies);

  fs.writeFileSync('/tmp/jd_track/login_browser_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/login_browser_resps.json', JSON.stringify(respLog, null, 2));

  console.log('\nAPI log:', apiLog.length, 'entries');
  console.log('Response log:', respLog.length, 'entries');
  console.log('\n=== 关键抓包已保存到 /tmp/jd_track/login_browser_*.json ===');

  await browser.close();
})();
