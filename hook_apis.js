// 第八轮：hook fetch + XMLHttpRequest，抓所有 API + 解密结果
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_hook';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const B64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--ignore-certificate-errors', '--lang=zh-CN,zh', '--window-size=1280,800'],
  });
  const ctx = await browser.createBrowserContext();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
  const page = await ctx.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // ===== 1. 在页面加载前注入 hook =====
  await page.evaluateOnNewDocument(() => {
    window.__HOOKED__ = [];
    const realFetch = window.fetch;
    window.fetch = async function(input, init) {
      const u = (typeof input === 'string' ? input : input.url);
      const r = await realFetch.apply(this, arguments);
      try {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const clone = r.clone();
          const body = await clone.json();
          // 存到 window 上
          window.__HOOKED__.push({
            t: Date.now(),
            url: u,
            method: init?.method || 'GET',
            body: body,
          });
          if (window.__HOOKED__.length > 100) window.__HOOKED__ = window.__HOOKED__.slice(-100);
        }
      } catch (e) {}
      return r;
    };

    // hook XHR
    const XO = window.XMLHttpRequest.prototype.open;
    const XS = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function(method, url) {
      this.__url = url;
      this.__method = method;
      return XO.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function(body) {
      this.addEventListener('readystatechange', function() {
        if (this.readyState === 4) {
          try {
            const ct = this.getResponseHeader('content-type') || '';
            if (ct.includes('json')) {
              const j = JSON.parse(this.responseText);
              window.__HOOKED__.push({
                t: Date.now(),
                url: this.__url,
                method: this.__method,
                body: j,
              });
            }
          } catch (e) {}
        }
      });
      return XS.apply(this, arguments);
    };
  });

  // ===== 2. 访问首页 =====
  console.log('=== visit homepage ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // 抓 hooked 结果
  const hk1 = await page.evaluate(() => window.__HOOKED__);
  fs.writeFileSync(path.join(OUT, '1_home_hooked.json'), JSON.stringify(hk1, null, 2));
  console.log('  home hooked:', hk1.length, 'API calls');
  hk1.forEach((h, i) => {
    const b = h.body;
    let info = {};
    if (b && typeof b === 'object') {
      info = { hasData: !!b.data, hasKey: !!b.key, dataLen: b.data?.length, keyLen: b.key?.length };
    } else { info = { type: typeof b, len: (b||'').length }; }
    console.log(' #' + i, h.method, h.url.replace('https://www.quradpk.com:2087', ''), JSON.stringify(info));
  });

  // ===== 3. 访问 novel/1 看更多 API =====
  console.log('=== visit /novel/1 ===');
  await page.evaluate(() => { window.__HOOKED__ = []; });
  await page.goto('https://www.quradpk.com:2087/novel/1', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);
  const hk2 = await page.evaluate(() => window.__HOOKED__);
  fs.writeFileSync(path.join(OUT, '2_novel_hooked.json'), JSON.stringify(hk2, null, 2));
  console.log('  novel hooked:', hk2.length, 'API calls');
  hk2.forEach((h, i) => {
    const b = h.body;
    let info = {};
    if (b && typeof b === 'object') {
      info = { hasData: !!b.data, hasKey: !!b.key, dataLen: b.data?.length, keyLen: b.key?.length };
    }
    console.log(' #' + i, h.method, h.url.replace('https://www.quradpk.com:2087', ''), JSON.stringify(info));
  });

  // ===== 4. 访问 /category/1 (视频) =====
  console.log('=== visit /category/1 ===');
  await page.evaluate(() => { window.__HOOKED__ = []; });
  await page.goto('https://www.quradpk.com:2087/category/1', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);
  const hk3 = await page.evaluate(() => window.__HOOKED__);
  fs.writeFileSync(path.join(OUT, '3_category_hooked.json'), JSON.stringify(hk3, null, 2));
  console.log('  category hooked:', hk3.length, 'API calls');
  hk3.forEach((h, i) => {
    const b = h.body;
    let info = {};
    if (b && typeof b === 'object') {
      info = { hasData: !!b.data, hasKey: !!b.key, dataLen: b.data?.length, keyLen: b.key?.length };
    }
    console.log(' #' + i, h.method, h.url.replace('https://www.quradpk.com:2087', ''), JSON.stringify(info));
  });

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
