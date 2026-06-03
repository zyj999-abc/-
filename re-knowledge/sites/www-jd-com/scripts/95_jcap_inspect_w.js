#!/usr/bin/env node
/**
 * 95_jcap_inspect_w.js
 *
 * 在浏览器内加载 jcap SDK，触发验证码，dump CaptchaWebAssembly 实例 (w) 的所有方法。
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
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

  await page.exposeFunction('logToNode', (msg) => console.log(msg));

  // 等待 SDK 加载 - 当 jcap 创建时，hook CaptchaWebAssembly
  // 用 debugger API hook
  const cdp = await page.target().createCDPSession();
  await cdp.send('Debugger.enable');
  await cdp.send('Runtime.enable');

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  async function humanInput(sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await sleep(100);
    await page.mouse.click(x, y, { clickCount: 3 });
    await sleep(100);
    for (const ch of text) {
      await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
    }
  }
  async function humanClick(sel) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 10 + Math.random() * (box.width - 20);
    const y = box.y + 5 + Math.random() * (box.height - 10);
    await page.mouse.move(x, y, { steps: 5 });
    await sleep(150);
    await page.mouse.click(x, y);
  }

  const ts = Date.now().toString().slice(-8);
  await humanInput('#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(500);
  await humanInput('#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  // 在 SDK 加载前，注入 hook
  await page.evaluate(() => {
    // hook XHR 拿 /api/check body
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      if (this._url && this._url.includes('/api/check')) {
        // 把 body 复制到 window 上等会被抓
        window.__checkBody = body;
        console.log('[CHECK]', body);
      }
      return origSend.apply(this, arguments);
    };

    // hook Function constructor? 不可靠
    // 改为：定时 dump 任何 jcap 相关对象
    setInterval(() => {
      // 遍历全局
      const found = [];
      for (const k of Object.keys(window)) {
        try {
          const v = window[k];
          if (typeof v === 'object' && v && v.constructor) {
            const cn = v.constructor.name;
            if (cn && cn.toLowerCase().includes('captcha')) {
              found.push({ k, cn, methods: Object.keys(v).slice(0, 20) });
            }
          }
        } catch (e) {}
      }
      if (found.length > 0) {
        window.__captchaInstances = found;
        console.log('[CAPTCHA]', JSON.stringify(found));
      }
    }, 2000);
  });

  let triggered = false;
  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2000);
      const r = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
      if (r) { console.log('触发 click=' + i); triggered = true; break; }
    }
    if (triggered) break;
    await sleep(5000);
  }
  if (!triggered) { console.log('未触发'); await browser.close(); return; }
  await sleep(5000);

  // 抓 CaptchaWebAssembly 实例
  const dump = await page.evaluate(() => {
    const out = {};
    if (window.__captchaInstances) out.captchaInstances = window.__captchaInstances;
    // 找 captcha 实例（不是 class）
    for (const k of Object.keys(window)) {
      try {
        const v = window[k];
        if (typeof v === 'object' && v && v.constructor) {
          const cn = v.constructor.name;
          if (cn === 'CaptchaWebAssembly' || cn === 'JCAPTCHA') {
            out[`window.${k}`] = {
              methods: Object.getOwnPropertyNames(Object.getPrototypeOf(v)),
              own: Object.keys(v).slice(0, 50),
            };
          }
        }
      } catch (e) {}
    }
    // 找所有 jcap iframe
    const iframes = document.querySelectorAll('iframe');
    out.iframes = iframes.length;
    for (let i = 0; i < iframes.length; i++) {
      try {
        const w = iframes[i].contentWindow;
        if (w) {
          for (const k of Object.keys(w)) {
            try {
              const v = w[k];
              if (typeof v === 'object' && v && v.constructor) {
                const cn = v.constructor.name;
                if (cn && (cn === 'CaptchaWebAssembly' || cn === 'JCAPTCHA')) {
                  out[`iframe${i}.${k}`] = {
                    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(v)),
                    own: Object.keys(v).slice(0, 50),
                  };
                }
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    // 抓 /api/check body
    if (window.__checkBody) {
      out.checkBody = window.__checkBody.substring(0, 500);
    }
    return out;
  });
  console.log('=== dump ===');
  console.log(JSON.stringify(dump, null, 2));

  await browser.close();
})();
