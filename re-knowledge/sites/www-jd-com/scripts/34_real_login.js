/**
 * 阶段 6 (修订): 真实京东登录触发 jdSlide
 *
 * 关键:
 *   - 用真实 login form 输入错误密码
 *   - 等京东自己出 jdSlide (或 jcap)
 *   - 拿 jdSlide 真实 validate
 *   - 协议化 loginService
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
  console.log(`[配置] PASSWORD: ${PASSWORD}`);

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

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/iv\.(jd|joybuy)|jcap\.m\.jd|loginService|password\/login|uc\/login/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 passport.jd.com/uc/login...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  // 检查真实 login 页面元素
  const loginInfo = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      name: i.name, id: i.id, type: i.type, visible: i.offsetWidth > 0, placeholder: i.placeholder,
    }));
    const buttons = Array.from(document.querySelectorAll('button, [type=submit], a[onclick]')).map(b => ({
      tag: b.tagName, text: (b.textContent || '').slice(0, 30), cls: b.className,
    }));
    return { forms: forms.length, inputs, buttons, url: location.href };
  });
  console.log('\n[2] Login page info:');
  console.log(JSON.stringify(loginInfo, null, 2));

  // 切换到账号登录 (用标签)
  await page.evaluate(() => {
    // 找账号登录 tab
    const tabs = Array.from(document.querySelectorAll('a, div, li, [role=tab]'));
    const accTab = tabs.find(t => t.textContent && t.textContent.includes('账号登录') && !t.className.includes('active'));
    if (accTab) accTab.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // 填账号密码
  console.log('\n[3] 填账号密码...');
  await page.evaluate((u, p) => {
    const acct = document.querySelector('#loginname') || document.querySelector('input[name=loginname]') || document.querySelector('input[type=text]:visible');
    const pwd = document.querySelector('#nloginpwd') || document.querySelector('input[name=nloginpwd]') || document.querySelector('input[type=password]:visible');
    if (acct) {
      acct.focus();
      acct.value = u;
      acct.dispatchEvent(new Event('input', { bubbles: true }));
      acct.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (pwd) {
      pwd.focus();
      pwd.value = p;
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      pwd.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      acct: acct ? { name: acct.name, id: acct.id, value: acct.value } : null,
      pwd: pwd ? { name: pwd.name, id: pwd.id, value: pwd.value } : null,
    };
  }, USERNAME, PASSWORD);

  // 等下 jdSlide/jcap 加载
  await new Promise(r => setTimeout(r, 3000));

  // 点击登录按钮
  console.log('\n[4] 点击登录按钮触发验证码...');
  await page.evaluate(() => {
    // 找 loginbtn
    const btn = document.querySelector('#loginBtn') || document.querySelector('#loginsubmit') || document.querySelector('a[onclick*=login]') || document.querySelector('button[type=button]');
    if (btn) btn.click();
  });

  // 等 jdSlide/jcap 出现
  await new Promise(r => setTimeout(r, 8000));

  await page.screenshot({ path: '/tmp/jd_track/phase6_login.png', fullPage: true });

  // 找 jdSlide DOM
  const jdslideInfo = await page.evaluate(() => {
    const slideBtn = document.querySelector('.JDJRV-slide-btn');
    const captcha = document.querySelector('#captcha_container, .jcap_main, .JDJRV-slide');
    const all = Array.from(document.querySelectorAll('[class*=JDJRV], [class*=jcap]')).map(el => ({
      tag: el.tagName, cls: el.className, id: el.id,
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
    }));
    return {
      slideBtn: slideBtn ? {
        display: window.getComputedStyle(slideBtn).display,
        rect: slideBtn.getBoundingClientRect(),
        class: slideBtn.className,
      } : null,
      captcha: captcha ? captcha.className : null,
      all,
    };
  });
  console.log('\n[5] 验证码状态:');
  console.log(JSON.stringify(jdslideInfo, null, 2).slice(0, 2500));

  // 看 loginService 响应
  const loginResps = respLog.filter(r => r.url.includes('login'));
  console.log(`\n[6] login 相关响应 (${loginResps.length} 条):`);
  for (const r of loginResps.slice(0, 5)) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${r.body.slice(0, 500)}`);
  }

  fs.writeFileSync('/tmp/jd_track/phase6_real_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
