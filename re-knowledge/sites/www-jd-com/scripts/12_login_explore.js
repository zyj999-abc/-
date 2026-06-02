// 探索 JD 登录入口 - passport.jd.com
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

  // 抓所有网络请求
  const apiLog = [];
  page.on('request', (req) => {
    const u = req.url();
    if (req.method() === 'POST' || /passport|login|auth|captcha|geetest|gt\.|risk/i.test(u)) {
      apiLog.push({
        method: req.method(),
        url: u,
        postData: req.postData(),
        headers: req.headers(),
        resourceType: req.resourceType(),
      });
    }
  });

  // 抓所有脚本 URL
  const scriptUrls = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/\.js(\?|$)/.test(u)) {
      try {
        const buf = await resp.buffer();
        if (buf && buf.length > 100) {
          const safe = u.replace(/[^a-zA-Z0-9.]/g, '_').slice(-100);
          fs.writeFileSync(`/tmp/jd_track/login_script_${safe}.js`, buf);
          scriptUrls.push({ url: u, size: buf.length });
        }
      } catch (e) {}
    }
  });

  console.log('[1] navigate to passport.jd.com');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));

  // 抓 HTML
  const html = await page.content();
  fs.writeFileSync('/tmp/jd_track/login.html', html);
  console.log('[2] HTML size:', html.length);

  // 抓所有 input/form 标签
  const formInfo = await page.evaluate(() => {
    const out = {};
    out.forms = [];
    document.querySelectorAll('form').forEach(f => {
      out.forms.push({
        id: f.id,
        action: f.action,
        method: f.method,
        inputs: [...f.querySelectorAll('input')].map(i => ({
          type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
          value: i.value, 'data-bind': i.getAttribute('data-bind'),
        })),
      });
    });
    out.scripts = [...document.scripts].map(s => s.src || '<inline>').filter(s => s && s !== '<inline>');
    out.bodyClass = document.body.className;
    out.title = document.title;
    out.globalKeys = Object.keys(window).filter(k => /jd|login|psign|sign|risk|geetest|captcha|encrypt|rsa/i.test(k)).slice(0, 50);
    // 找 global 上的关键对象
    out.PSign = typeof window.PSign;
    out.JD = typeof window.JD;
    out.jQuery = typeof window.jQuery;
    out.GBLOG = typeof window.GBLOG;
    out.GEETEST = typeof window.GEETEST;
    return out;
  });

  // 抓全局变量中的 RSA 公钥 + 加密函数
  const rsaInfo = await page.evaluate(() => {
    const out = {};
    // 找 window 上所有的 RSA 公钥字符串
    const findPubKey = (obj, path = '', depth = 0) => {
      if (depth > 4) return;
      if (!obj || typeof obj !== 'object') return;
      for (const k of Object.keys(obj)) {
        try {
          const v = obj[k];
          if (typeof v === 'string' && /MIIB[A-Za-z0-9+/=]{40,}/.test(v)) {
            out[path + '.' + k] = v.slice(0, 100) + '...';
          } else if (typeof v === 'object' && v !== null) {
            findPubKey(v, path + '.' + k, depth + 1);
          }
        } catch (e) {}
      }
    };
    findPubKey(window);

    // 找 JSEncrypt / encrypt 函数
    out.hasJSEncrypt = typeof window.JSEncrypt;
    out.hasencrypt = typeof window.encrypt;
    out.hasRSAKey = typeof window.RSAKey;
    out.encryptKeys = Object.keys(window).filter(k => /encrypt|sign|password|pwd|crypt|rsa/i.test(k)).slice(0, 20);

    return out;
  });

  // 抓 page 上可见的提示（用于了解登录流程）
  const pageInfo = await page.evaluate(() => {
    const out = {};
    // 抓 title 和 hint
    out.title = document.title;
    out.hint = [...document.querySelectorAll('.form .item-fore, .login-tab, .login-box, .tip')].map(e => e.innerText).slice(0, 5);
    // 抓所有 button
    out.buttons = [...document.querySelectorAll('button, .btn, a.btn')].map(b => b.innerText || b.textContent).filter(Boolean).slice(0, 20);
    return out;
  });

  fs.writeFileSync('/tmp/jd_track/login_apis.json', JSON.stringify(apiLog, null, 2));
  fs.writeFileSync('/tmp/jd_track/login_scripts.json', JSON.stringify(scriptUrls, null, 2));
  fs.writeFileSync('/tmp/jd_track/login_form.json', JSON.stringify(formInfo, null, 2));
  fs.writeFileSync('/tmp/jd_track/login_rsa.json', JSON.stringify(rsaInfo, null, 2));
  fs.writeFileSync('/tmp/jd_track/login_page_info.json', JSON.stringify(pageInfo, null, 2));

  console.log('[3] forms:', formInfo.forms.length);
  console.log('[3] scripts:', formInfo.scripts.length);
  console.log('[3] global keys:', formInfo.globalKeys.length);
  console.log('[3] API calls:', apiLog.length);
  console.log('[3] script urls:', scriptUrls.length);
  console.log('[3] PSign:', formInfo.PSign, 'JD:', formInfo.JD, 'jQuery:', formInfo.jQuery);
  console.log('[3] has JSEncrypt:', rsaInfo.hasJSEncrypt);
  console.log('[3] has encrypt:', rsaInfo.hasencrypt);
  console.log('[3] encryptKeys:', rsaInfo.encryptKeys);
  console.log('[3] RSA keys found:', Object.keys(rsaInfo).filter(k => k.startsWith('window.') || k.startsWith('jd.') || k.includes('.')));
  console.log('[3] buttons:', pageInfo.buttons);

  await page.screenshot({ path: '/tmp/jd_track/login_page.png' });

  await browser.close();
  console.log('done');
})();
