/**
 * 阶段 6 (修订3): 切换到账号密码登录 tab
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

  // 切换到账号登录
  console.log('\n[2] 切换到账号登录 tab...');
  const tabInfo = await page.evaluate(() => {
    // 找 "账号登录" tab
    const all = Array.from(document.querySelectorAll('div, a, li, span'));
    const candidates = all.filter(el => {
      const t = el.textContent || '';
      return t.includes('账号登录') && el.children.length < 5;
    });
    return {
      candidates: candidates.map(c => ({ tag: c.tagName, cls: c.className, text: c.textContent.slice(0, 50), id: c.id })).slice(0, 5),
    };
  });
  console.log('  候选 tab:', JSON.stringify(tabInfo, null, 2));

  await page.evaluate(() => {
    // 京东 tab 结构: .login-tab .tab-item[data-tab=account]
    const tab = document.querySelector('[data-tab=account]') || document.querySelector('.tab-item[onclick*=account]');
    if (tab) tab.click();
    else {
      // 退一步，找包含"账号登录"的 click 元素
      const all = Array.from(document.querySelectorAll('*'));
      const t = all.find(el => el.textContent.trim() === '账号登录' && (el.tagName === 'A' || el.tagName === 'LI' || el.tagName === 'DIV'));
      if (t) t.click();
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  // 找输入框
  const inputs = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll('input')).filter(i => i.offsetWidth > 0 && i.offsetHeight > 0);
    return visible.map(i => ({ name: i.name, id: i.id, type: i.type, placeholder: i.placeholder }));
  });
  console.log('\n[3] 可见 input:', JSON.stringify(inputs, null, 2));

  // 填账号密码
  await page.evaluate((u, p) => {
    const acct = document.querySelector('#loginname') || document.querySelector('input[type=text]') || document.querySelector('input[type=tel]');
    const pwd = document.querySelector('#nloginpwd') || document.querySelector('input[type=password]');
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
      acctFilled: !!acct,
      pwdFilled: !!pwd,
    };
  }, USERNAME, PASSWORD);
  console.log('  填入完成');

  await new Promise(r => setTimeout(r, 2000));

  // 找登录按钮
  const loginBtnInfo = await page.evaluate(() => {
    // 京东登录按钮 .btn-login a 或 .login-btn
    const btn = document.querySelector('a.btn-login') || document.querySelector('.login-btn') ||
                document.querySelector('button.login-btn') || document.querySelector('[class*=login-btn]') ||
                document.querySelector('#loginsubmit');
    return btn ? {
      tag: btn.tagName,
      cls: btn.className,
      text: (btn.textContent || '').slice(0, 50),
      visible: btn.offsetWidth > 0,
    } : null;
  });
  console.log('\n[4] login btn:', JSON.stringify(loginBtnInfo));

  // 点击登录
  if (loginBtnInfo && loginBtnInfo.visible) {
    await page.evaluate(() => {
      const btn = document.querySelector('a.btn-login') || document.querySelector('.login-btn') ||
                  document.querySelector('button.login-btn') || document.querySelector('[class*=login-btn]');
      if (btn) btn.click();
    });
    console.log('  点击');
  } else {
    // 试着用键盘提交
    await page.keyboard.press('Enter');
    console.log('  按 Enter');
  }

  // 等验证码
  await new Promise(r => setTimeout(r, 8000));
  await page.screenshot({ path: '/tmp/jd_track/phase6_v3_after.png', fullPage: true });

  // 检查状态
  const v = await page.evaluate(() => {
    return {
      jcapAll: Array.from(document.querySelectorAll('[class*=jcap], [id*=jcap]')).map(e => ({
        tag: e.tagName, cls: e.className, id: e.id, visible: e.offsetWidth > 0,
      })),
      slideAll: Array.from(document.querySelectorAll('[class*=JDJRV], [class*=slide]')).map(e => ({
        tag: e.tagName, cls: e.className, id: e.id, visible: e.offsetWidth > 0,
      })),
      // 找 btn
      slideBtn: (() => {
        const b = document.querySelector('.JDJRV-slide-btn');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { display: window.getComputedStyle(b).display, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
      })(),
    };
  });
  console.log('\n[5] 验证码状态:');
  console.log(JSON.stringify(v, null, 2).slice(0, 2500));

  console.log(`\n[6] 后端响应 (${respLog.length} 条):`);
  const summary = {};
  for (const r of respLog) {
    const m = r.url.match(/(jcap|slide|loginService|seq\.jd|gia\.jd|jra\.jd)/);
    const k = m ? m[1] : 'other';
    summary[k] = (summary[k] || 0) + 1;
  }
  console.log('  summary:', JSON.stringify(summary));

  // jcap 详细
  const jcapResps = respLog.filter(r => r.url.includes('jcap') && !r.url.includes('.js'));
  console.log(`\n  jcap API (${jcapResps.length} 条):`);
  for (const r of jcapResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${r.body.slice(0, 800)}`);
  }
  // jdSlide
  const slideResps = respLog.filter(r => r.url.includes('iv.'));
  console.log(`\n  jdSlide API (${slideResps.length} 条):`);
  for (const r of slideResps) {
    console.log(`  [${r.status}] ${r.url.slice(0, 200)}`);
    console.log(`    body: ${r.body.slice(0, 600)}`);
  }

  fs.writeFileSync('/tmp/jd_track/phase6_v3_resps.json', JSON.stringify(respLog, null, 2));
  await browser.close();
})();
