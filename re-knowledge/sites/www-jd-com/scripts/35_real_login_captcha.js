/**
 * 阶段 6 (修订2): 等 jcap/jdSlide 触发 + 真实 DOM 分析
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

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.match(/jcap\.m\.jd|iv\.(jd|joybuy)|uc\/loginService|seq\.jd|gia\.jd|jra\.jd|cactus\.jd/)) {
      try {
        const txt = await resp.text();
        respLog.push({ ts: Date.now(), url, status: resp.status(), body: txt });
      } catch (e) {}
    }
  });

  console.log('[1] 打开 login page...');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // 找账号密码 input
  console.log('\n[2] 找 login form...');
  const formInfo = await page.evaluate(() => {
    const accts = Array.from(document.querySelectorAll('input[type=text], input[type=tel], input:not([type])'));
    const pwds = Array.from(document.querySelectorAll('input[type=password]'));
    return {
      accts: accts.map(a => ({ name: a.name, id: a.id, placeholder: a.placeholder, visible: a.offsetWidth > 0 })),
      pwds: pwds.map(p => ({ name: p.name, id: p.id, placeholder: p.placeholder, visible: p.offsetWidth > 0 })),
      buttons: Array.from(document.querySelectorAll('button, [type=submit], a.btn-login, [class*=login]')).map(b => ({ tag: b.tagName, text: b.textContent.slice(0, 30), cls: b.className, onclick: b.onclick ? 'has' : 'no' })).slice(0, 10),
    };
  });
  console.log(JSON.stringify(formInfo, null, 2));

  // 填账号密码
  console.log('\n[3] 填账号密码...');
  await page.evaluate((u, p) => {
    const acct = document.querySelector('#loginname') || document.querySelector('input[type=text]') || document.querySelector('input[type=tel]');
    const pwd = document.querySelector('#nloginpwd') || document.querySelector('input[type=password]');
    if (acct) {
      acct.value = u;
      acct.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (pwd) {
      pwd.value = p;
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, USERNAME, PASSWORD);

  await new Promise(r => setTimeout(r, 1000));

  // 点击登录 - 用 J_Login 锚点
  console.log('\n[4] 点击登录按钮...');
  await page.evaluate(() => {
    // 京东登录按钮是 .btn-login 或 J_Login a 标签
    const a = document.querySelector('a.btn-login') || document.querySelector('.login-btn') || document.querySelector('[class*=login][class*=btn]');
    if (a) {
      console.log('点击:', a.className);
      a.click();
    } else {
      // 找包含 "登录" 文字的元素
      const all = Array.from(document.querySelectorAll('a, button, [role=button]'));
      const loginBtn = all.find(el => el.textContent && el.textContent.trim() === '登录');
      if (loginBtn) loginBtn.click();
    }
  });

  // 等验证码出现
  await new Promise(r => setTimeout(r, 8000));
  await page.screenshot({ path: '/tmp/jd_track/phase6_v2_1.png', fullPage: true });

  // 检查验证码状态
  const v1 = await page.evaluate(() => {
    const c = document.querySelector('.jcap_main, .JDJRV-slide, #JDJRV-wrap, .captcha, [class*=captcha], [class*=slide]');
    return {
      found: !!c,
      className: c ? c.className : null,
      innerHTML: c ? c.outerHTML.slice(0, 1500) : null,
      jcapAll: Array.from(document.querySelectorAll('[class*=jcap]')).map(e => e.className).slice(0, 10),
      slideAll: Array.from(document.querySelectorAll('[class*=JDJRV]')).map(e => e.className).slice(0, 10),
    };
  });
  console.log('\n[5] v1 状态:');
  console.log(JSON.stringify(v1, null, 2).slice(0, 3000));

  // 看响应
  console.log(`\n[6] 后端响应 (${respLog.length} 条):`);
  const summary = {};
  for (const r of respLog) {
    const m = r.url.match(/(jcap|slide|loginService|seq\.jd|gia\.jd|jra\.jd)/);
    const k = m ? m[1] : 'other';
    summary[k] = (summary[k] || 0) + 1;
  }
  console.log('  summary:', JSON.stringify(summary));

  // jcap 详细
  const jcapResps = respLog.filter(r => r.url.includes('jcap'));
  console.log(`\n  jcap 响应 (${jcapResps.length} 条):`);
  for (const r of jcapResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${r.body.slice(0, 600)}`);
  }

  // slide
  const slideResps = respLog.filter(r => r.url.includes('slide') || r.url.includes('iv.'));
  console.log(`\n  slide 响应 (${slideResps.length} 条):`);
  for (const r of slideResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${r.body.slice(0, 600)}`);
  }

  fs.writeFileSync('/tmp/jd_track/phase6_v2_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
