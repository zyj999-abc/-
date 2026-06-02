// 第十三轮：抓 _abc, tongji 全局对象找解密钥
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v13';
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

  const out = await page.evaluate(async () => {
    const o = {};
    const root = document.querySelector('#app').__vue_app__;
    const cfg = root.config;
    const gp = cfg.globalProperties;

    // 1. _abc 完整内容
    if (gp._abc) {
      o._abc_type = typeof gp._abc;
      o._abc_keys = Object.keys(gp._abc).slice(0, 50);
      o._abc_str = JSON.stringify(gp._abc, (k, v) => {
        if (typeof v === 'function') return v.toString().slice(0, 500);
        if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '...';
        return v;
      }, 2).slice(0, 5000);
    }

    // 2. tongji 完整内容
    if (gp.tongji) {
      o.tongji_type = typeof gp.tongji;
      o.tongji_str = gp.tongji.toString().slice(0, 2000);
    }

    // 3. global_isShowApp
    if (gp.global_isShowApp) {
      o.global_isShowApp_type = typeof gp.global_isShowApp;
      o.global_isShowApp_str = gp.global_isShowApp.toString().slice(0, 2000);
    }

    // 4. global_go_back
    if (gp.global_go_back) {
      o.global_go_back_str = gp.global_go_back.toString().slice(0, 2000);
    }

    // 5. 遍历 _abc 函数
    if (gp._abc && typeof gp._abc === 'object') {
      const funcs = {};
      for (const k of Object.keys(gp._abc)) {
        const v = gp._abc[k];
        if (typeof v === 'function') {
          funcs[k] = v.toString().slice(0, 1000);
        }
      }
      o._abc_funcs = funcs;
    }

    // 6. 拿 _abc 内部是否含 qh (axios)
    if (gp._abc && gp._abc.qh) {
      o.qh_keys = Object.keys(gp._abc.qh).slice(0, 30);
      o.qh_str = JSON.stringify(gp._abc.qh, (k, v) => {
        if (typeof v === 'function') return '[FUNC]';
        if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '...';
        return v;
      }, 2).slice(0, 5000);
    }

    // 7. 尝试调用 _abc.qh.get('/v1/vod/123') 拿真实数据
    try {
      if (gp._abc && gp._abc.qh) {
        const r = await gp._abc.qh.get('/v1/vod/1', { params: { c: 1 } });
        o.tryVod1 = JSON.stringify(r, (k, v) => {
          if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '...';
          return v;
        }, 2).slice(0, 5000);
      }
    } catch (e) { o.tryVod1Err = e.message; }

    return o;
  });
  fs.writeFileSync(path.join(OUT, '1_inspect.json'), JSON.stringify(out, null, 2));
  console.log('=== _abc type:', out._abc_type, 'keys:', out._abc_keys?.length);
  console.log('=== tongji type:', out.tongji_type);
  console.log('=== _abc.qh keys:', out.qh_keys);
  console.log('=== _abc str (前 3000):', out._abc_str?.slice(0, 3000));
  console.log('=== tongji str:', out.tongji_str?.slice(0, 500));
  console.log('=== tryVod1 (前 3000):', out.tryVod1?.slice(0, 3000));

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
