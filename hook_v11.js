// 第十一轮：直接调 API 拿到视频 ID 列表 + 访问真实视频详情
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v11';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
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

  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // 在浏览器里 hook XHR 拿所有 API
  await page.evaluateOnNewDocument(() => {
    window.__XHR_HOOK__ = [];
    const XO = window.XMLHttpRequest.prototype.open;
    const XS = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function(m, u) { this.__url = u; return XO.apply(this, arguments); };
    window.XMLHttpRequest.prototype.send = function() {
      this.addEventListener('readystatechange', function() {
        if (this.readyState === 4) {
          try {
            const ct = this.getResponseHeader('content-type') || '';
            if (ct.includes('json')) {
              window.__XHR_HOOK__.push({ url: this.__url, body: JSON.parse(this.responseText) });
            }
          } catch (e) {}
        }
      });
      return XS.apply(this, arguments);
    };
  });

  // 重新加载
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);
  const hk = await page.evaluate(() => window.__XHR_HOOK__);
  console.log('=== hooked XHR count:', hk.length);
  hk.forEach((h, i) => {
    const b = h.body;
    if (b && typeof b === 'object' && (b.data || b.list)) {
      console.log(' #' + i, h.url);
    }
  });

  // 拿 blist 的解密数据：让浏览器帮解密
  const decrypted = await page.evaluate(async () => {
    // 找前端的 decrypt 函数
    // 用 Object.keys 看 window 上有什么
    const out = {};
    out.windowKeys = Object.keys(window).filter(k => /decr|aes|sm4|cipher/i.test(k)).slice(0, 20);

    // 直接在 main bundle 找 decrypt 函数定义
    // 先把首页所有 v1/blist 抓的 data 拿来
    const xhrs = window.__XHR_HOOK__ || [];
    out.blistData = xhrs.find(x => x.url.includes('blist'))?.body;
    out.vodCatData = xhrs.find(x => x.url.includes('vod/category'))?.body;

    // 让 Vue 自己解密：调用 __app__.$root? 找 app
    try {
      // 找 Vue app 实例
      const root = document.querySelector('#app')?.__vue_app__;
      out.hasVue = !!root;
      if (root) {
        out.vueConfig = Object.keys(root.config.globalProperties).slice(0, 20);
      }
    } catch (e) { out.vueErr = e.message; }

    return out;
  });
  fs.writeFileSync(path.join(OUT, '1_decrypted.json'), JSON.stringify(decrypted, null, 2));
  console.log('=== windowKeys:', decrypted.windowKeys);
  console.log('=== hasVue:', decrypted.hasVue);
  console.log('=== blist data len:', decrypted.blistData?.data?.length, 'key len:', decrypted.blistData?.key?.length);

  // 试一个真实视频 ID
  // 先看 vod 列表的 ID 格式
  const vodApi = await page.evaluate(async () => {
    // 直接抓 vod 列表
    const r = await fetch('/v1/vod?c=1&sort=new&page=1&limit=10');
    return await r.json();
  });
  fs.writeFileSync(path.join(OUT, '2_vod_list_raw.json'), JSON.stringify(vodApi, null, 2));
  console.log('=== vod list data len:', vodApi.data?.length, 'key len:', vodApi.key?.length);

  // 让浏览器解密 vod 列表：在 Vue 实例上找
  const vodList = await page.evaluate(async () => {
    // 通过 patch qh 库（在 main bundle 里）的方法拿解密
    // 或者直接看 main bundle 全局变量
    // 尝试找 process 或 webpack module
    const candidates = [];
    for (const k of Object.keys(window)) {
      try {
        const v = window[k];
        if (typeof v === 'function' && v.toString().length > 100) {
          if (/decryp|sm4|aes|cbc/i.test(v.toString())) {
            candidates.push({ key: k, len: v.toString().length });
          }
        }
      } catch (e) {}
    }
    return candidates;
  });
  console.log('=== decrypt funcs in window:', vodList);

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
