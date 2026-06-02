/**
 * 阶段 6 (修订4): 深度看 slide-authCode-wraper 真实流程
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
  console.log(`[配置] USERNAME: ${USERNAME}`);

  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
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

  // 拦截所有 fetch / XHR
  await page.evaluateOnNewDocument(() => {
    window.__xhrs = [];
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
      try {
        window.__xhrs.push({ method: 'fetch', url, body: opts ? opts.body : null, time: Date.now() });
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    const origXhr = window.XMLHttpRequest;
    window.XMLHttpRequest = class extends origXhr {
      open(method, url) {
        this.__url = url;
        this.__method = method;
        return super.open(method, url);
      }
      send(body) {
        try {
          window.__xhrs.push({ method: this.__method, url: this.__url, body, time: Date.now() });
        } catch (e) {}
        return super.send(body);
      }
    };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/jcap\.m\.jd|iv\.(jd|joybuy)|uc\/loginService|seq\.jd|gia\.jd|jra\.jd|cactus\.jd|sgm\.jd/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 login page...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 填账号密码
  console.log('\n[2] 填账号密码...');
  await page.evaluate((u, p) => {
    const acct = document.querySelector('#loginname');
    const pwd = document.querySelector('#nloginpwd');
    if (acct) {
      acct.value = u;
      acct.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (pwd) {
      pwd.value = p;
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, USERNAME, PASSWORD);

  await new Promise(r => setTimeout(r, 3000));

  // 强制 click 多次触发风控/验证码
  console.log('\n[3] 多次点击登录...');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector('.login-btn');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 4000));
  }

  await page.screenshot({ path: '/tmp/jd_track/phase6_v4.png', fullPage: true });

  // 看 jcap/jdSlide 状态
  const state = await page.evaluate(() => {
    return {
      jcap: Array.from(document.querySelectorAll('[class*=jcap], [id*=jcap]')).map(e => ({ tag: e.tagName, cls: e.className, id: e.id, visible: e.offsetWidth > 0 })),
      jdSlide: Array.from(document.querySelectorAll('[class*=JDJRV], [class*=slide-authCode]')).map(e => ({ tag: e.tagName, cls: e.className, id: e.id, visible: e.offsetWidth > 0 })),
      // 滑块按钮
      slideBtn: (() => {
        const b = document.querySelector('.JDJRV-slide-btn, .slide-authCode-btn, [class*=slide-btn]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { cls: b.className, display: window.getComputedStyle(b).display, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
      })(),
      // 看是否出"图片验证码"
      hasGraphicCaptcha: !!document.querySelector('#graphicCaptchaSessionId, .graphic-captcha, [class*=graphic]'),
    };
  });
  console.log('\n[4] 验证码状态:');
  console.log(JSON.stringify(state, null, 2).slice(0, 3000));

  // 拦截的 XHR
  const xhrs = await page.evaluate(() => window.__xhrs);
  console.log(`\n[5] 拦截 XHR (${xhrs.length} 条):`);
  for (const x of xhrs.slice(-30)) {
    const url = typeof x.url === 'string' ? x.url : (x.url.url || '');
    if (url.match(/jcap|slide|login|seq|gia|jra|cactus|sgm|fingerprint/)) {
      console.log(`  [${x.method}] ${url.slice(0, 200)}`);
      if (x.body && typeof x.body === 'string' && x.body.length < 500) {
        console.log(`    body: ${x.body}`);
      }
    }
  }

  console.log(`\n[6] resp log: ${respLog.length} 条`);
  const summary = {};
  for (const r of respLog) {
    const m = r.url.match(/(jcap|slide|loginService|seq\.jd|gia\.jd|jra\.jd|cactus|sgm)/);
    const k = m ? m[1] : 'other';
    summary[k] = (summary[k] || 0) + 1;
  }
  console.log('  summary:', JSON.stringify(summary));

  // jcap API 调用（不是 js）
  const jcapApis = respLog.filter(r => r.url.includes('jcap') && !r.url.includes('.js'));
  console.log(`\n  jcap API: ${jcapApis.length}`);
  for (const r of jcapApis) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${r.body.slice(0, 500)}`);
  }
  // jdSlide
  const slideApis = respLog.filter(r => r.url.includes('iv.') && !r.url.includes('.js') && !r.url.includes('.css'));
  console.log(`\n  jdSlide API: ${slideApis.length}`);
  for (const r of slideApis) {
    console.log(`  [${r.status}] ${r.url.slice(0, 250)}`);
    console.log(`    body: ${r.body.slice(0, 500)}`);
  }

  fs.writeFileSync('/tmp/jd_track/phase6_v4_resps.json', JSON.stringify(respLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/phase6_v4_xhrs.json', JSON.stringify(xhrs, null, 2));
  await browser.close();
})();
