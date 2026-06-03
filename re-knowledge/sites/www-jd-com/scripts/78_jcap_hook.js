#!/usr/bin/env node
/**
 * 78_jcap_hook.js
 *
 * 直接 hook 进 captcha 的内部方法，绕过 mouse 事件复杂性：
 * 1. 触发验证码
 * 2. 找到 captcha 组件实例（通过 Vue 内部）
 * 3. 直接调用它的 xyList 和 checkCaptcha
 * 4. 拿 vt token
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('jcap') && url.includes('/api/')) {
      try {
        const txt = await resp.text();
        respLog.push({ url, body: txt });
      } catch (e) {}
    }
  });

  // 注入调试代码 - 暴露 captcha 实例
  await page.evaluateOnNewDocument(() => {
    window.__captchaInfo = null;
    // 定时查找 captcha
    const findCaptcha = () => {
      const cpc = document.querySelector('#cpc_img');
      if (cpc && !window.__captchaInfo) {
        // 找 vue 实例
        const root = cpc.closest('[data-v-app], #app, .captcha_modal, [class*=captcha]');
        if (root && root.__vue__) {
          window.__captchaInfo = root.__vue__;
        }
        // 找所有 vue 实例
        const allVue = document.querySelectorAll('*');
        for (const el of allVue) {
          if (el.__vue__ && el.__vue__.$options && el.__vue__.$options.methods) {
            const m = el.__vue__.$options.methods;
            if (m.checkCaptcha || m.slidingEnd || m.handleMouseStart) {
              window.__captchaInfo = el.__vue__;
              break;
            }
          }
        }
      }
    };
    setInterval(findCaptcha, 1000);
  });

  console.log('[1] 打开登录页');
  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3000);

  const ts = Date.now().toString().slice(-8);
  console.log('[2] 输入账号密码');
  await page.click('#loginname', { clickCount: 3 });
  await page.type('#loginname', `jd_test_${ts}@163.com`, { delay: 80 });
  await sleep(300);
  await page.click('#nloginpwd', { clickCount: 3 });
  await page.type('#nloginpwd', 'Pwd!@#abc1234', { delay: 80 });
  await sleep(500);

  console.log('[3] 点击登录触发验证码');
  for (let click = 1; click <= 3; click++) {
    await page.click('.login-btn');
    await sleep(5000);
    const hasCaptcha = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
    if (hasCaptcha) {
      console.log(`  点击 ${click} 次后触发验证码`);
      break;
    }
  }
  await sleep(5000);

  // 找 captcha 实例
  const captchaInfo = await page.evaluate(() => {
    const findVue = (root) => {
      const found = [];
      const walk = (el) => {
        if (el.__vue__) {
          found.push(el.__vue__);
        }
        for (const c of el.children) walk(c);
      };
      walk(root);
      return found;
    };
    const all = findVue(document.body);
    let captchaInstance = null;
    for (const v of all) {
      if (v.$options && v.$options.methods) {
        const m = v.$options.methods;
        if (m.checkCaptcha) {
          captchaInstance = v;
          break;
        }
      }
    }
    if (!captchaInstance) return { error: 'no captcha instance found' };

    // 找 cpc_img rect
    const cpc = document.querySelector('#cpc_img');
    let cpcRect = null;
    if (cpc) {
      const r = cpc.getBoundingClientRect();
      cpcRect = { x: r.x, y: r.y, w: cpc.offsetWidth, h: cpc.offsetHeight };
    }

    return {
      hasInstance: true,
      methods: Object.keys(captchaInstance.$options.methods || {}),
      data: JSON.parse(JSON.stringify(captchaInstance.$data || {})),
      cpcRect,
    };
  });

  console.log('[4] Captcha 实例:');
  if (captchaInfo.error) {
    console.log('  ❌', captchaInfo.error);
    await page.screenshot({ path: '/tmp/jd_track/78_no_captcha.png', fullPage: true });
    await browser.close();
    return;
  }
  console.log('  methods:', captchaInfo.methods.join(', '));
  console.log('  data keys:', Object.keys(captchaInfo.data).join(', '));
  console.log('  cpcRect:', JSON.stringify(captchaInfo.cpcRect));

  // 保存 cpc_img
  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc || !cpc.src) return null;
    return { src: cpc.src, w: cpc.naturalWidth || cpc.width, h: cpc.naturalHeight || cpc.height };
  });
  if (imgInfo) {
    const b64 = imgInfo.src.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync('/tmp/jd_track/78_captcha.jpg', Buffer.from(b64, 'base64'));
    console.log('  saved:', (b64.length * 3 / 4 / 1024).toFixed(1), 'KB');
  }

  await browser.close();
})();
