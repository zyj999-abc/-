/**
 * 阶段 4-5 重做: 完整触发 jcap 内部流程，捕获 verify 接口
 *
 * 关键: 创建 captcha instance 后，调其内部 verify() 方法，
 *       jcap SDK 会自动发起 fp → check → 显示验证码 流程
 *       然后在浏览器中看实际的 verify 接口协议
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
  console.log(`[配置] 测试账号: ${USERNAME} / 密码: ${PASSWORD}`);

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--window-size=1366,768',
    ],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const apiLog = [];
  const respLog = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/loginService|jcap\.m\.jd|geetest|seq\.|cactus|jra|sgm-|ivs\.|gia\.|h5speed/.test(u)) {
      apiLog.push({ ts: Date.now(), method: req.method(), url: u, postData: req.postData() });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/loginService|jcap\.m\.jd|geetest/.test(u)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url: u, status: resp.status(), body: txt.slice(0, 3000) });
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
    sa_token: $('#sa_token').val(),
    pubKey: $('#pubKey').val(),
    useSlideAuthCode: $('#useSlideAuthCode').val(),
    graphicCaptchaStatus: $('#graphicCaptchaStatus').val(),
    graphicCaptchaSessionId: $('#graphicCaptchaSessionId').val(),
    graphicCaptchaJwtToken: $('#graphicCaptchaJwtToken').val(),
  }));

  // 填表
  await page.type('#loginname', USERNAME, { delay: 30 });
  await page.type('#nloginpwd', PASSWORD, { delay: 30 });
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n[2] 触发 jcap SDK 完整流程...');
  console.log('  - 创建 captcha instance (appId=1000803)');
  console.log('  - 等待 SDK 自动调 fp / check');
  console.log('  - 触发滑块/图片码');
  console.log('  - 拦截所有 jcap 网络请求');

  // 调 captchaLoadJS，完整触发 jcap
  const result = await page.evaluate((USERNAME, form) => {
    return new Promise((resolve, reject) => {
      if (typeof captchaLoadJS !== 'function') {
        reject(new Error('captchaLoadJS not defined'));
        return;
      }
      const container = document.createElement('div');
      container.id = 'jcap-container-debug';
      container.style.cssText = 'position:fixed;top:50px;right:10px;width:400px;height:500px;z-index:99999;background:#fff;border:2px solid red;padding:10px;overflow:auto;';
      document.body.appendChild(container);

      let phase = 'init';
      let captchaInstance = null;
      const events = [];

      const option = {
        appId: '1000803',
        sceneId: 'login_pc',
        account: USERNAME,
        sessionId: form.graphicCaptchaSessionId,
        element: container,
        lang: 'zh-CN',
        onSuccess: (data) => {
          events.push({ phase: 'onSuccess', data: data });
          resolve({ ok: true, events: events, vt: data?.vt || data, finalPhase: 'onSuccess' });
        },
        onFailure: (err) => {
          events.push({ phase: 'onFailure', err: String(err) });
          // 继续等待其他事件
        },
        onLoad: (info) => {
          events.push({ phase: 'onLoad', info: info });
        },
        onReady: () => {
          events.push({ phase: 'onReady' });
          phase = 'ready';
          // 保存 instance 引用
          if (window.jdCAP) {
            captchaInstance = window.jdCAP;
          }
        },
        onCancel: () => {
          events.push({ phase: 'onCancel' });
        },
      };

      // captchaLoadJS(option, callback)
      captchaLoadJS(option, (captchaIns) => {
        if (captchaIns) {
          events.push({ phase: 'callback', hasInstance: true, type: typeof captchaIns });
          // 保存 instance 到 window 方便后续操作
          window.__captchaIns = captchaIns;
          // 列出 captchaIns 的所有方法
          if (typeof captchaIns === 'object') {
            events.push({ phase: 'instance_methods', methods: Object.keys(captchaIns) });
            // 尝试调 show()
            if (typeof captchaIns.show === 'function') {
              try {
                captchaIns.show();
                events.push({ phase: 'show_called' });
              } catch (e) {
                events.push({ phase: 'show_error', err: String(e) });
              }
            }
          }
          // 5s 后 resolve 让脚本继续
          setTimeout(() => {
            resolve({ ok: true, events: events, finalPhase: phase, hasInstance: !!captchaIns });
          }, 8000);
        } else {
          resolve({ ok: false, events: events, err: 'no instance' });
        }
      });

      setTimeout(() => reject(new Error('overall timeout 15s')), 15000);
    });
  }, USERNAME, form);

  console.log('\n[3] captcha 流程结果:');
  console.log(JSON.stringify(result, null, 2).slice(0, 2000));

  // 看 jcap 网络请求
  const jcapApis = apiLog.filter(a => a.url.includes('jcap.m.jd.com'));
  const jcapResps = respLog.filter(r => r.url.includes('jcap.m.jd.com'));
  console.log(`\n[4] jcap API: ${jcapApis.length} 个`);
  for (const a of jcapApis) {
    console.log(`  [${a.method}] ${a.url}`);
    console.log(`    body: ${a.postData?.slice(0, 400)}`);
  }
  console.log(`\n[5] jcap 响应: ${jcapResps.length} 个`);
  for (const r of jcapResps) {
    console.log(`  [${r.status}] ${r.url}`);
    console.log(`    body: ${r.body.slice(0, 500)}`);
  }

  fs.writeFileSync('/tmp/jd_track/jcap2_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/jcap2_resps.json', JSON.stringify(respLog, null, 2));
  await page.screenshot({ path: '/tmp/jd_track/jcap2.png', fullPage: true });

  await browser.close();
})();
