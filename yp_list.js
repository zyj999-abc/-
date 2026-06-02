// 第十六轮：调用 /v1/yp 拿视频列表 + 抓真实详情页
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v16';
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

  // 1. 在浏览器里执行 axios fetch /v1/yp 拿视频列表（已解密）
  console.log('=== fetch /v1/yp ===');
  const result = await page.evaluate(async () => {
    const out = {};
    // 直接 fetch 拿到原始数据
    const r1 = await fetch('/v1/yp?c=10&t=zy&at=0&page=1');
    const j1 = await r1.json();
    out.ypRaw = { data: j1.data, key: j1.key };

    // 拿 site 配置
    const root = document.querySelector('#app').__vue_app__;
    if (root) {
      // 找所有 v1 列表返回的 data
      // 抓 root._instance.data
      const inst = root._instance;
      out.hasInst = !!inst;
      if (inst && inst.data) {
        out.dataKeys = Object.keys(inst.data).slice(0, 30);
        // 抓 video list 数据
        for (const k of Object.keys(inst.data)) {
          const v = inst.data[k];
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
            out['data_' + k] = v.slice(0, 3);
          } else if (typeof v === 'object' && v !== null) {
            const ks = Object.keys(v);
            if (ks.length > 0) out['obj_' + k] = ks;
          }
        }
      }
    }

    // 抓所有 __xhrData
    out.localStorage = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out.localStorage[k] = localStorage.getItem(k).slice(0, 300);
    }

    return out;
  });
  fs.writeFileSync(path.join(OUT, '1_yp_raw.json'), JSON.stringify(result, null, 2));
  console.log('=== yp data len:', result.ypRaw?.data?.length, 'key len:', result.ypRaw?.key?.length);
  console.log('=== dataKeys:', result.dataKeys);
  console.log('=== localStorage keys:', Object.keys(result.localStorage || {}).join(','));
  if (result.dataKeys) {
    result.dataKeys.forEach(k => {
      if (result['data_' + k]) {
        console.log(' data[' + k + ']:', JSON.stringify(result['data_' + k][0]).slice(0, 300));
      } else if (result['obj_' + k]) {
        console.log(' obj[' + k + ']:', result['obj_' + k].join(','));
      }
    });
  }

  // 2. 找 axios decrypt 函数：在 setup state 里
  console.log('=== find decrypt funcs ===');
  const funcs = await page.evaluate(() => {
    const root = document.querySelector('#app').__vue_app__;
    if (!root) return {};
    const out = {};
    // 抓所有 setup state 里的函数
    const inst = root._instance;
    if (inst && inst.setupState) {
      const ss = inst.setupState;
      for (const k of Object.keys(ss)) {
        const v = ss[k];
        if (typeof v === 'function' && v.toString().length > 50) {
          out['sf_' + k] = v.toString().slice(0, 2000);
        }
      }
    }
    // 抓所有 data 里的函数
    if (inst && inst.data) {
      const d = inst.data;
      for (const k of Object.keys(d)) {
        const v = d[k];
        if (typeof v === 'function' && v.toString().length > 50) {
          out['df_' + k] = v.toString().slice(0, 2000);
        }
      }
    }
    return out;
  });
  fs.writeFileSync(path.join(OUT, '2_funcs.json'), JSON.stringify(funcs, null, 2));
  console.log('=== setup funcs:', Object.keys(funcs).filter(k => k.startsWith('sf_')).length);
  console.log('=== data funcs:', Object.keys(funcs).filter(k => k.startsWith('df_')).length);
  // 打印 setup funcs
  Object.entries(funcs).filter(([k]) => k.startsWith('sf_')).forEach(([k, v]) => {
    console.log(' ' + k + ':', v.slice(0, 200));
  });

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
