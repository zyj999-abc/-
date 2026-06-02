// 第十二轮：从 Vue app 内部拿解密数据
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v12';
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

  // 从 Vue app 内部找解密的 axios
  const out = await page.evaluate(() => {
    const o = {};
    try {
      const root = document.querySelector('#app').__vue_app__;
      const cfg = root.config;
      o.globalProps = Object.keys(cfg.globalProperties).slice(0, 50);
      o.provides = Object.keys(root._context.provides).slice(0, 20);
      // 抓所有 provide 的 value
      const provs = {};
      for (const k of Object.keys(root._context.provides)) {
        const sym = root._context.provides[k];
        if (sym && typeof sym === 'object') {
          provs[k] = Object.keys(sym).slice(0, 10);
        }
      }
      o.provs = provs;

      // 找 axios / $http / $fetch
      const candidates = ['$axios', '$http', '$fetch', 'axios', 'http', 'fetch', 'api', 'service', 'request'];
      for (const k of candidates) {
        if (cfg.globalProperties[k]) {
          o['has_' + k] = typeof cfg.globalProperties[k];
        }
      }

      // 遍历所有组件实例，找 data() 里的 list / 视频
      const vids = [];
      const walk = (inst) => {
        if (!inst) return;
        if (inst.proxy && inst.proxy.$data) {
          const d = inst.proxy.$data;
          for (const k of Object.keys(d)) {
            const v = d[k];
            if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
              if (v[0].id || v[0].title || v[0].name || v[0].vod_id) {
                vids.push({ comp: inst.type?.__name || inst.type?.name || 'unk', dataKey: k, count: v.length, sample: v[0] });
              }
            }
          }
        }
        if (inst.subTree) walk(inst.subTree);
        if (inst.children) for (const c of inst.children) walk(c);
      };
      walk(root._instance);
      o.videoLists = vids.slice(0, 20);

      // 抓 main bundle 的 axios
      // 试试 import 暴露
      if (window.__vite__ && window.__vite__.moduleCache) {
        o.viteModules = Object.keys(window.__vite__.moduleCache).slice(0, 20);
      }
    } catch (e) { o.err = e.message; }
    return o;
  });
  fs.writeFileSync(path.join(OUT, '1_vue_inspect.json'), JSON.stringify(out, null, 2));
  console.log('=== globalProps:', out.globalProps);
  console.log('=== has_*:', Object.keys(out).filter(k => k.startsWith('has_')).map(k => k + ':' + out[k]).join(', '));
  console.log('=== videoLists:', out.videoLists?.length);
  out.videoLists?.forEach((v, i) => console.log(' #' + i, v.comp, v.dataKey, 'count=' + v.count, 'sample.id=' + v.sample.id, 'title=' + v.sample.title?.slice(0, 30)));

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
