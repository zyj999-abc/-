// 触发登录请求（用占位账号，捕获完整请求+响应+可能的滑块）
const puppeteer = require('puppeteer-core');
const fs = require('fs');

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

  // 拦截所有 api/login/passport 请求
  const apiLog = [];
  page.on('request', (req) => {
    const u = req.url();
    if (req.method() === 'POST' || /login|captcha|geetest|jcap|seq\.|risk|uc\//.test(u)) {
      apiLog.push({
        method: req.method(),
        url: u,
        postData: req.postData(),
        headers: req.headers(),
      });
    }
  });

  // 拦截响应
  const respLog = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/login|captcha|geetest|jcap|seq\.|risk|uc\/loginService/.test(u)) {
      try {
        const txt = await resp.text();
        respLog.push({
          url: u,
          status: resp.status(),
          body: txt.slice(0, 3000),
          setCookie: resp.headers()['set-cookie'],
        });
      } catch (e) {}
    }
  });

  console.log('[1] navigate to passport.jd.com');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 在浏览器中：填测试账号 + 点击登录（不期待成功，只为了看流程）
  console.log('[2] filling test account');
  await page.evaluate(() => {
    // 填一个测试用户名（不存在账号，看返回什么）
    const u = document.getElementById('loginname');
    if (u) {
      u.focus();
      u.value = 'test_user_12345';
      u.dispatchEvent(new Event('input', { bubbles: true }));
      u.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const p = document.getElementById('nloginpwd');
    if (p) {
      p.focus();
      p.value = 'TestPwd123!';
      p.dispatchEvent(new Event('input', { bubbles: true }));
      p.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // 抓当前 form 字段
  const formData = await page.evaluate(() => {
    return {
      loginname: document.getElementById('loginname')?.value,
      nloginpwd: document.getElementById('nloginpwd')?.value?.length,
      eid: document.getElementById('eid')?.value,
      pubKey: document.getElementById('pubKey')?.value?.slice(0, 50) + '...',
      sessionId: document.getElementById('sessionId')?.value,
      sa_token: document.getElementById('sa_token')?.value?.slice(0, 50) + '...',
      hasParamsSign: typeof window.paramsSingUtils === 'function',
      hasEncryptPwd: typeof window.getEntryptPwd === 'function',
    };
  });
  console.log('[3] form data:', JSON.stringify(formData, null, 2));

  // 点击登录按钮（不期待成功）
  console.log('[4] click login button');
  try {
    await page.click('#loginsubmit', { timeout: 5000 });
  } catch (e) {
    console.log('  click err:', e.message);
  }

  // 等 8s 看响应
  await new Promise(r => setTimeout(r, 8000));

  // 抓页面错误信息
  const errorMsg = await page.evaluate(() => {
    return {
      msg: document.querySelector('.msg-error')?.innerText || document.querySelector('.msg-warn')?.innerText || null,
      fullText: document.querySelector('.login-form')?.innerText?.slice(0, 1000) || null,
    };
  });
  console.log('[5] error msg:', JSON.stringify(errorMsg, null, 2));

  fs.writeFileSync('/tmp/jd_track/login_attempt_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/login_attempt_responses.json', JSON.stringify(respLog, null, 2));

  console.log('[6] api calls:', apiLog.length);
  console.log('[6] resp calls:', respLog.length);

  // 打印关键响应
  for (const r of respLog) {
    console.log('---');
    console.log(r.url.slice(0, 200));
    console.log('  status:', r.status);
    if (r.body) console.log('  body (first 200):', r.body.slice(0, 200));
    if (r.setCookie) console.log('  set-cookie:', r.setCookie.slice(0, 200));
  }

  await page.screenshot({ path: '/tmp/jd_track/login_after_click.png' });
  await browser.close();
  console.log('done');
})();
