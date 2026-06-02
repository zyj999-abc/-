// 第十七轮：抓 Vue 组件里的视频列表数据（已解密）
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v17';
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

  // 拦截 axios
  await page.evaluateOnNewDocument(() => {
    window.__AXIOS__ = [];
    // 等 axios 加载
    const interval = setInterval(() => {
      if (window.axios) {
        clearInterval(interval);
        // 拦截 axios
        const origGet = window.axios.get;
        window.axios.get = function(...args) {
          return origGet.apply(this, args).then(r => {
            window.__AXIOS__.push({ method: 'get', url: args[0], data: r.data });
            return r;
          });
        };
      }
    }, 100);

    // hook XHR
    window.__XHR__ = [];
    const XO = XMLHttpRequest.prototype.open;
    const XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, u) { this.__url = u; return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('readystatechange', function() {
        if (this.readyState === 4) {
          try {
            const ct = this.getResponseHeader('content-type') || '';
            if (ct.includes('json')) {
              window.__XHR__.push({ url: this.__url, body: JSON.parse(this.responseText) });
            }
          } catch (e) {}
        }
      });
      return XS.apply(this, arguments);
    };
  });

  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);

  // 抓所有组件实例的 data
  console.log('=== walk all component data ===');
  const result = await page.evaluate(() => {
    const out = {};
    const root = document.querySelector('#app').__vue_app__;
    if (!root) return { err: 'no vue' };

    // 找 axios 实例
    out.hasAxios = !!window.axios;

    // 抓所有 setup data
    const allData = [];
    const allComputed = [];
    const walk = (inst, depth = 0, path = '') => {
      if (!inst || depth > 15) return;
      if (inst.setupState) {
        const ss = inst.setupState;
        for (const k of Object.keys(ss)) {
          const v = ss[k];
          if (Array.isArray(v) && v.length > 0) {
            if (typeof v[0] === 'object' && v[0] && (v[0].id || v[0].title || v[0].name)) {
              allData.push({ path: path + '/' + k, len: v.length, sample: v[0] });
            }
          } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            const ks = Object.keys(v);
            if (ks.length > 0 && ks.length < 20) {
              // 可能是 list data ref
            }
          }
        }
      }
      if (inst.subTree) walk(inst.subTree, depth+1, path);
      if (inst.children) for (const c of inst.children) walk(c, depth+1, path);
    };
    walk(root._instance);
    out.allData = allData.slice(0, 30);

    // 抓 XHR 数据
    out.xhr = (window.__XHR__ || []).map(x => ({ url: x.url, data: x.body }));

    return out;
  });
  fs.writeFileSync(path.join(OUT, '1_walk.json'), JSON.stringify(result, null, 2));
  console.log('=== allData:', result.allData?.length);
  result.allData?.forEach(d => {
    console.log(' ' + d.path + ' (len ' + d.len + '):', JSON.stringify(d.sample).slice(0, 200));
  });
  console.log('=== XHR:', result.xhr?.length);
  result.xhr?.slice(0, 5).forEach(x => {
    console.log(' X', x.url);
    if (x.data) console.log('    data:', JSON.stringify(x.data).slice(0, 300));
  });

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
