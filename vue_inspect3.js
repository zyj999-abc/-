// 第十三轮 bis: 抓 Nu (axios) + Vc (md5) + jd
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v13b';
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
    const ctx = root._context;

    // 遍历所有 provide 找 Nu
    const provs = {};
    for (const k of Object.keys(ctx.provides)) {
      const sym = ctx.provides[k];
      if (sym) provs[k] = String(sym).slice(0, 100);
    }
    o.provides = provs;

    // 遍历整个组件树找 Nu
    const found = {};
    const walk = (inst, depth = 0) => {
      if (!inst || depth > 10) return;
      const ctx = inst.proxy?.$;
      if (ctx) {
        for (const k of Object.keys(ctx)) {
          if (/^(Nu|Vc|jd|Ad|Zh|qh|qA)$/.test(k)) {
            const v = ctx[k];
            if (v && typeof v === 'object' && !found[k]) {
              found[k] = {
                type: typeof v,
                keys: Object.keys(v).slice(0, 20),
                str: String(v).slice(0, 500),
              };
            }
          }
        }
      }
      if (inst.subTree) walk(inst.subTree, depth+1);
      if (inst.children) for (const c of inst.children) walk(c, depth+1);
    };
    walk(root._instance);
    o.found = found;

    // 抓 __app__ 上挂的 Nu
    if (ctx.config.globalProperties.Nu) {
      const Nu = ctx.config.globalProperties.Nu;
      o.Nu_str = String(Nu).slice(0, 1000);
      o.Nu_keys = Object.keys(Nu).slice(0, 20);
    }

    // 抓 Vc 函数
    for (const k of Object.keys(window)) {
      if (k === 'Vc' || k === 'Nu' || k === 'jd' || k === 'Ad' || k === 'Zh' || k === 'qh') {
        o['window_' + k] = String(window[k]).slice(0, 1000);
      }
    }

    // 抓根实例 ctx
    const rootCtx = root._instance?.proxy?.$;
    if (rootCtx) {
      o.rootCtxKeys = Object.keys(rootCtx).slice(0, 50);
    }

    // 抓根实例的 setupState
    const setup = root._instance?.setupState;
    if (setup) {
      o.setupKeys = Object.keys(setup).slice(0, 50);
      const str = {};
      for (const k of Object.keys(setup).slice(0, 30)) {
        const v = setup[k];
        if (v && typeof v === 'object') {
          str[k] = { type: typeof v, keys: Object.keys(v).slice(0, 10) };
        } else {
          str[k] = typeof v;
        }
      }
      o.setupMap = str;
    }

    return o;
  });
  fs.writeFileSync(path.join(OUT, '1_inspect.json'), JSON.stringify(out, null, 2));
  console.log('=== provides:', out.provides);
  console.log('=== found:', JSON.stringify(out.found, null, 2).slice(0, 2000));
  console.log('=== window_Nu:', out.window_Nu?.slice(0, 500));
  console.log('=== rootCtxKeys:', out.rootCtxKeys);
  console.log('=== setupKeys:', out.setupKeys);
  console.log('=== setupMap:', JSON.stringify(out.setupMap, null, 2).slice(0, 2000));

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
