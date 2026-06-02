/**
 * 阶段3-完整：抓完整 loginService POST body + 完整响应
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

  page.on('request', (req) => {
    if (/loginService|jcap\.m\.jd/.test(req.url())) {
      console.log(`[REQ ${req.method()}] ${req.url()}`);
      console.log(`  body (${req.postData()?.length} chars): ${req.postData()}`);
    }
  });
  page.on('response', async (resp) => {
    if (/loginService|jcap\.m\.jd/.test(resp.url())) {
      try {
        const txt = await resp.text();
        console.log(`[RESP ${resp.status()}] ${resp.url()}`);
        console.log(`  body (${txt.length} chars): ${txt.slice(0, 2000)}`);
        for (const sc of resp.headers()['set-cookie'] || []) {
          console.log(`  set-cookie: ${sc}`);
        }
      } catch (e) {}
    }
  });

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
    pubKey: $('#pubKey').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    firstShowAccountLoginPage: $('#firstShowAccountLoginPage').val(),
    graphicCaptchaStatus: $('#graphicCaptchaStatus').val(),
    graphicCaptchaAppId: $('#graphicCaptchaAppId').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val(),
    sa_token: $('#sa_token').val(),
    expgroup: $('#expgroup').val(),
    pageSource: $('#pageSource').val(),
    pageLocation: $('#pageLocation').val(),
  }));

  // 触发 jcap 拿 st/fp
  const jcapInfo = await page.evaluate(async () => {
    // jcap fp
    const fpResp = await fetch('https://jcap.m.jd.com/cgi-bin/api/fp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://passport.jd.com/' },
      body: 'si=&ct=&fp=',
    });
    const fpText = await fpResp.text();
    const fp = (() => { try { return JSON.parse(fpText); } catch (e) { return { raw: fpText, status: fpResp.status }; } })();
    const fpResp2 = await fetch('https://jcap.m.jd.com/cgi-bin/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://passport.jd.com/' },
      body: `si=&lang=1&tk=${fp.st || ''}&appId=1000803`,
    });
    const checkText = await fpResp2.text();
    const check = (() => { try { return JSON.parse(checkText); } catch (e) { return { raw: checkText, status: fpResp2.status }; } })();
    return { fp, check };
  });
  console.log('=== jcap fp ===');
  console.log(JSON.stringify(jcapInfo.fp, null, 2));
  console.log('=== jcap check ===');
  console.log(JSON.stringify(jcapInfo.check, null, 2));

  // RSA 加密密码
  const nloginpwd = await page.evaluate((pubKey, pwd) => {
    const c = new JSEncrypt();
    c.setPublicKey(pubKey);
    return c.encrypt(pwd);
  }, form.pubKey, 'TestPwd123!');
  console.log('=== RSA encrypted password (nloginpwd) ===');
  console.log(`  ${nloginpwd} (${nloginpwd.length} chars)`);

  // 构造完整 POST body
  const body = await page.evaluate((form, nloginpwd) => {
    const data = new URLSearchParams();
    data.append('uuid', form.uuid);
    data.append('eid', form.eid);
    data.append('fp', form.fp);
    data.append('eid2', form.eid2);
    data.append('_t', form.token);
    data.append('loginType', form.loginType);
    data.append('loginname', 'test_user_12345');
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
    if (form.graphicCaptchaSessionId) data.append('graphicCaptchaSessionId', form.graphicCaptchaSessionId);
    if (form.graphicCaptchaJwtToken) data.append('graphicCaptchaJwtToken', form.graphicCaptchaJwtToken);
    return data.toString();
  }, form, nloginpwd);

  console.log('=== 完整 loginService POST body (无 h5st/vt) ===');
  console.log(`body length: ${body.length} chars`);
  console.log(body);
  console.log('');

  // POST
  const loginResp = await page.evaluate(async (body) => {
    const r = await fetch(`/uc/loginService?r=${Math.random()}&version=2015`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Referer: 'https://passport.jd.com/uc/login',
      },
      body,
    });
    const text = await r.text();
    return { status: r.status, text, cookies: document.cookie };
  }, body);

  console.log('=== loginService 完整响应 ===');
  console.log(`status: ${loginResp.status}`);
  console.log(`body: ${loginResp.text}`);
  console.log(`cookies: ${loginResp.cookies}`);

  await browser.close();
})();
