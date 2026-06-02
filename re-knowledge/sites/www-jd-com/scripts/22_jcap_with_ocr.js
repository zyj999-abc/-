/**
 * 阶段 4-6 终极: jcap 协议化登录（OCR + 浏览器内 SDK 拿 vt）
 *
 * 流程:
 * 1. 打开 passport.jd.com 拿 form
 * 2. 填随机测试账号密码
 * 3. 创建 captcha instance → 触发 jcap fp / check
 * 4. 拿到 jcap check 响应里的 base64 图片码
 * 5. 用 ddddocr 识别图片码
 * 6. 调 captcha instance 的 verify 传入答案 → 拿 vt
 * 7. 用 vt + 22 字段协议化 POST /uc/loginService
 * 8. 拿 set-cookie 里的 pt_key / pt_pin
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');

const randomStr = (n) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const USERNAME = `jdtest${randomStr(6)}@163.com`;
const PASSWORD = `Pwd${randomStr(8)}!@#`;

function ocrImage(imagePath) {
  try {
    const pyCode = `import ddddocr; ocr = ddddocr.DdddOcr(); f = open('${imagePath}', 'rb'); data = f.read(); f.close(); print(ocr.classification(data))`;
    const result = execSync(`python3 -c "${pyCode.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' });
    return result.trim();
  } catch (e) {
    console.log('OCR err:', e.message);
    return null;
  }
}

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
    if (req.url().includes('jcap.m.jd.com') || req.url().includes('loginService') || req.url().includes('cactus') || req.url().includes('sgm') || req.url().includes('jra')) {
      apiLog.push({ ts: Date.now(), method: req.method(), url: req.url(), postData: req.postData() });
    }
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('jcap.m.jd.com') || resp.url().includes('loginService')) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url: resp.url(), status: resp.status(), body: txt, setCookie: resp.headers()['set-cookie'] });
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
    sa_token: $('#sa_token').val(),
    pubKey: $('#pubKey').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    firstShowAccountLoginPage: $('#firstShowAccountLoginPage').val(),
    graphicCaptchaStatus: $('#graphicCaptchaStatus').val(),
    graphicCaptchaAppId: $('#graphicCaptchaAppId').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val(),
    expgroup: $('#expgroup').val(),
    pageSource: $('#pageSource').val(),
    pageLocation: $('#pageLocation').val(),
  }));

  console.log(`  uuid: ${form.uuid}`);
  console.log(`  eid: ${form.eid?.slice(0, 30)}...`);
  console.log(`  fp: ${form.fp}`);
  console.log(`  eid2: ${form.eid2?.slice(0, 50)}...`);
  console.log(`  sa_token: ${form.sa_token?.length} chars`);
  console.log(`  graphicCaptchaSessionId: ${form.graphicCaptchaSessionId?.slice(0, 30)}...`);

  await page.type('#loginname', USERNAME, { delay: 30 });
  await page.type('#nloginpwd', PASSWORD, { delay: 30 });
  await new Promise(r => setTimeout(r, 2000));

  // ===== 阶段 4-5: 触发 jcap fp / check，拿图片码 =====
  console.log('\n[2] 触发 jcap fp / check ...');

  const jcapResult = await page.evaluate(async (USERNAME, form) => {
    return new Promise((resolve) => {
      if (typeof captchaLoadJS !== 'function') {
        resolve({ err: 'captchaLoadJS not defined' });
        return;
      }
      const option = {
        appId: '1000803',
        sceneId: 'login_pc',
        account: USERNAME,
        sessionId: form.graphicCaptchaSessionId,
        element: document.body,
        lang: 'zh-CN',
        onSuccess: (data) => resolve({ phase: 'onSuccess', data: data }),
        onFailure: (err) => resolve({ phase: 'onFailure', err: String(err) }),
        onLoad: (info) => console.log('onLoad', info),
        onReady: () => console.log('onReady'),
        onCancel: () => console.log('onCancel'),
      };
      captchaLoadJS(option, (captchaIns) => {
        // 调 create() 触发 fp
        // 调 appCheck() 触发 check
        try {
          if (typeof captchaIns.create === 'function') captchaIns.create();
        } catch (e) { console.log('create err:', e.message); }
        try {
          if (typeof captchaIns.appCheck === 'function') captchaIns.appCheck();
        } catch (e) { console.log('appCheck err:', e.message); }

        // 保存 captcha instance 引用
        window.__captchaIns = captchaIns;
        // 等 8s 让 jcap 完成
        setTimeout(() => {
          resolve({
            phase: 'ready',
            hasAppCheck: typeof captchaIns.appCheck === 'function',
            hasCreate: typeof captchaIns.create === 'function',
            hasVerify: typeof captchaIns.verify === 'function',
            sessionId: captchaIns.getSessionId ? captchaIns.getSessionId() : '',
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(captchaIns) || {}).concat(Object.keys(captchaIns)),
            allOptions: Object.keys(captchaIns.options || {}),
          });
        }, 8000);
      });
      setTimeout(() => resolve({ err: 'overall timeout 15s' }), 15000);
    });
  }, USERNAME, form);

  console.log('\n[3] jcap result:');
  console.log(JSON.stringify(jcapResult, null, 2));

  // 看 jcap check 响应拿到 base64 图片码
  const checkResp = respLog.find(r => r.url.includes('jcap.m.jd.com/cgi-bin/api/check'));
  let captchaText = null;
  let captchaImgPath = null;
  if (checkResp) {
    try {
      const data = JSON.parse(checkResp.body);
      console.log(`\n[4] jcap.check tp: ${data.tp}, st: ${data.st}`);
      if (data.tp === 30 && data.img) {
        // 解析 img (JSON 字符串)
        let imgObj = {};
        try { imgObj = JSON.parse(data.img); } catch (e) { imgObj = data.img; }
        // 找 base64 jpg
        for (const [k, v] of Object.entries(imgObj)) {
          if (typeof v === 'string' && v.startsWith('data:image')) {
            const m = v.match(/^data:image\/(\w+);base64,(.+)$/);
            if (m) {
              const ext = m[1];
              const b64 = m[2];
              captchaImgPath = `/tmp/jd_track/captcha_${k}.${ext}`;
              const bin_data = Buffer.from(b64, 'base64');
              fs.writeFileSync(captchaImgPath, bin_data);
              console.log(`  ✓ 已保存图片码: ${captchaImgPath} (${bin_data.length} bytes)`);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log('  parse err:', e.message);
    }
  }

  // ===== 阶段 5: OCR 识别图片码 =====
  if (captchaImgPath) {
    console.log(`\n[5] OCR 识别图片码: ${captchaImgPath}`);
    captchaText = ocrImage(captchaImgPath);
    if (captchaText) {
      console.log(`  ✓ OCR 结果: "${captchaText}"`);
    }
  }

  // ===== 阶段 6: 调 captcha instance 的 verify 拿 vt =====
  let vt = null;
  if (captchaText) {
    console.log(`\n[6] 调 captchaIns.verify() 传入答案 "${captchaText}"...`);
    const verifyResult = await page.evaluate(async (captchaText) => {
      return new Promise((resolve) => {
        const captchaIns = window.__captchaIns;
        if (!captchaIns) {
          resolve({ err: 'no captcha instance' });
          return;
        }
        // jcap verify 接受什么参数? 让我们先试基本形式
        // 1. verify(answer)
        // 2. verify({ answer })
        // 3. setCachaOption + verify
        try {
          if (typeof captchaIns.setCachaOption === 'function') {
            captchaIns.setCachaOption({ userInput: captchaText });
            console.log('setCachaOption called');
          }
        } catch (e) { console.log('setCachaOption err:', e.message); }

        // 调 verify (异步)
        const callVerify = async () => {
          if (typeof captchaIns.verify === 'function') {
            try {
              const result = await captchaIns.verify();
              return { ok: true, result: String(result).slice(0, 200) };
            } catch (e) {
              return { err: 'verify err: ' + e.message };
            }
          } else {
            return { err: 'verify not function' };
          }
        };

        // 触发新的 check 流程
        try {
          if (typeof captchaIns.appCheck === 'function') {
            captchaIns.appCheck();
            console.log('appCheck re-called');
          }
        } catch (e) { console.log('appCheck re-err:', e.message); }

        // 等 5s 看新响应
        setTimeout(async () => {
          const r = await callVerify();
          resolve(r);
        }, 5000);
      });
    }, captchaText);

    console.log('  verify result:', JSON.stringify(verifyResult, null, 2));

    // 看 verify 接口响应
    const verifyResp = respLog.find(r => r.url.includes('jcap.m.jd.com/cgi-bin/api/verify') || r.url.includes('jcap.m.jd.com/cgi-bin/api/check') && r.ts > checkResp.ts);
    if (verifyResp) {
      console.log(`  verify/check resp: ${verifyResp.body.slice(0, 500)}`);
      try {
        const data = JSON.parse(verifyResp.body);
        if (data.vt) {
          vt = data.vt;
          console.log(`  ✓ 拿到 vt: ${vt.slice(0, 30)}...`);
        }
      } catch (e) {}
    }
  }

  // 看所有 jcap 响应
  console.log('\n[7] 所有 jcap 响应:');
  for (const r of respLog.filter(r => r.url.includes('jcap'))) {
    console.log(`  [${r.status}] ${r.url}`);
    console.log(`    body: ${r.body.slice(0, 400)}`);
  }

  // ===== 阶段 7: 协议化 POST /uc/loginService =====
  console.log('\n[8] 协议化 POST /uc/loginService...');
  if (vt) {
    console.log(`  用 vt: ${vt.slice(0, 30)}...`);
  } else {
    console.log('  ⚠️ 无 vt，但尝试协议化 POST（看响应）');
  }

  // 在浏览器内协议化 POST
  const loginResult = await page.evaluate(async (form, USERNAME, PASSWORD, vt) => {
    // RSA 加密密码
    const crypt = new JSEncrypt();
    crypt.setPublicKey(form.pubKey);
    const nloginpwd = crypt.encrypt(PASSWORD);

    // 构造 POST body
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
    data.append('pageSource', form.pageSource);
    data.append('pageLocation', form.pageLocation);
    data.append('firstShowAccountLoginPage', form.firstShowAccountLoginPage);
    data.append('ssoDomains', '');
    data.append('expgroup', form.expgroup);
    if (form.graphicCaptchaSessionId) data.append('graphicCaptchaSessionId', form.graphicCaptchaSessionId);
    if (form.graphicCaptchaJwtToken) data.append('graphicCaptchaJwtToken', form.graphicCaptchaJwtToken);
    if (vt) data.append('graphicCaptchaVerifyToken', vt);

    const resp = await fetch(`/uc/loginService?r=${Math.random()}&version=2015`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: data.toString(),
      credentials: 'include',
    });
    const text = await resp.text();
    let obj = null;
    try { obj = eval('(' + text + ')'); } catch (e) {}

    return {
      status: resp.status,
      body: text,
      obj: obj,
      cookies: document.cookie,
    };
  }, form, USERNAME, PASSWORD, vt);

  console.log(`\n[9] loginService 响应:`);
  console.log(`  status: ${loginResult.status}`);
  console.log(`  body: ${loginResult.body.slice(0, 800)}`);
  if (loginResult.obj) {
    console.log(`  success: ${loginResult.obj.success}`);
    console.log(`  transfer: ${loginResult.obj.transfer}`);
    console.log(`  rescue: ${loginResult.obj.rescue}`);
    console.log(`  newSafeVerify: ${loginResult.obj.newSafeVerify}`);
    console.log(`  username: ${loginResult.obj.username}`);
    console.log(`  pwd: ${loginResult.obj.pwd}`);
    console.log(`  emptyAuthcode: ${loginResult.obj.emptyAuthcode}`);
  }
  console.log(`  cookies: ${loginResult.cookies}`);

  fs.writeFileSync('/tmp/jd_track/final_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/final_resps.json', JSON.stringify(respLog, null, 2));
  console.log('\n完整抓包已保存: /tmp/jd_track/final_*.json');
  await page.screenshot({ path: '/tmp/jd_track/final.png', fullPage: true });

  await browser.close();
})();
