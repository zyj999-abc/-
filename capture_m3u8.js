// 第十四轮：让浏览器访问首页并自动点击第一个视频，捕获 m3u8
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v14';
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

  // 抓所有 m3u8 / mp4 / ts 响应
  const media = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (/\.(m3u8|ts|m4s|mp4)(\?|$)/.test(u)) {
      try {
        const buf = await res.buffer();
        media.push({ url: u, status: res.status(), size: buf.length, ct: res.headers()['content-type'], body: buf.toString('utf-8').slice(0, 10000) });
        console.log('  [MEDIA]', res.status(), u, 'size:', buf.length);
      } catch (e) {
        media.push({ url: u, status: res.status(), err: e.message });
      }
    }
  });

  // 抓所有 XHR (含 auth_key 路径)
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('m3u8') || u.includes('.ts') || u.includes('auth_key') || u.includes('video/m3u8') || u.includes('video/play')) {
      console.log('  [REQ]', req.method(), u);
    }
  });

  console.log('=== load homepage ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);

  // 在浏览器里 hook 拦截 router.push 拿跳转目标
  // 或者直接看 click handler
  // 最简单：抓所有 a 链接 click

  // 找第一个视频卡片（在遮罩之上）。用 querySelectorAll 找带 srcset 或 data 属性
  const firstVideoInfo = await page.evaluate(() => {
    // 找 video-related 元素
    const out = {};
    // 1. 找所有带 "id" 属性像 vod_id 的元素
    const items = Array.from(document.querySelectorAll('[data-id], [data-vod-id], [data-vid]'));
    out.itemsWithDataId = items.slice(0, 5).map(e => ({ tag: e.tagName, attrs: Array.from(e.attributes).map(a => `${a.name}=${a.value}`).join(', ').slice(0, 200) }));

    // 2. 找所有 li 卡片
    const lis = Array.from(document.querySelectorAll('li'));
    out.lis = lis.length;

    // 3. 找卡片元素 - 包含 img 的链接
    const cardLinks = Array.from(document.querySelectorAll('a'))
      .filter(a => a.querySelector('img'))
      .map(a => ({
        href: a.href,
        text: a.innerText?.slice(0, 50),
        hasImg: !!a.querySelector('img'),
        rect: { w: a.getBoundingClientRect().width, h: a.getBoundingClientRect().height },
      }))
      .filter(x => x.rect.w > 0 && x.rect.h > 0)
      .slice(0, 10);
    out.cardLinks = cardLinks;

    // 4. 找所有包含 vod 字样的元素
    const vodElements = Array.from(document.querySelectorAll('[class*="vod"], [class*="video"], [class*="card"]'));
    out.vodClassCount = vodElements.length;

    return out;
  });
  console.log('=== cardLinks:', firstVideoInfo.cardLinks?.length);
  firstVideoInfo.cardLinks?.forEach((c, i) => console.log(' #' + i, c.href.slice(0, 100), 'text:', c.text));

  // ===== 1. 直接跳到 /vod/{id} 路径，挨个试 =====
  // 之前 32hU62DB 包含 video-category，但路径未知
  // 试 /video/1, /v/1, /vod/1, /play/1
  for (const path of ['/video/1', '/video/2', '/video/3', '/v/1', '/v/2', '/vod/1', '/play/1', '/watch/1', '/yx/1', '/yp/1']) {
    console.log('\n=== try', path);
    media.length = 0;
    try {
      await page.goto('https://www.quradpk.com:2087' + path, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(5000);
      const t = await page.title();
      const vids = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc));
      console.log('  title:', t, 'vids:', vids.length, 'media:', media.length);
      if (vids.length > 0 || media.length > 0) {
        vids.forEach(v => console.log('    video src:', v));
        media.slice(0, 3).forEach(m => console.log('    media:', m.url, 'body:', m.body?.slice(0, 200)));
        if (media.length > 0) {
          fs.writeFileSync(path.join(OUT, 'media_' + path.replace(/\//g, '_') + '.json'), JSON.stringify(media, null, 2));
        }
        if (vids.length > 0) break;
      }
    } catch (e) { console.log('  err:', e.message); }
  }

  // ===== 2. 试直接访问首页第一个 a[href*="/v/"] =====
  if (firstVideoInfo.cardLinks?.[0]) {
    const href = firstVideoInfo.cardLinks[0].href;
    console.log('\n=== visit first card:', href);
    media.length = 0;
    try {
      await page.goto(href, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(5000);
      const t = await page.title();
      console.log('  title:', t);
      const vids = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc));
      console.log('  vids:', vids.length);
      vids.forEach(v => console.log('    video src:', v));
      media.slice(0, 3).forEach(m => console.log('    media:', m.url));
    } catch (e) { console.log('  err:', e.message); }
  }

  // ===== 3. 直接调用 __app__ 内部 Nu 调 vod 列表 =====
  console.log('\n=== call Nu from app ===');
  const apiResult = await page.evaluate(async () => {
    const out = {};
    const root = document.querySelector('#app').__vue_app__;
    const cfg = root.config;
    const gp = cfg.globalProperties;

    // 尝试在 _abc 找到 qh
    if (gp._abc && gp._abc.length > 0) {
      out._abc_str = gp._abc.toString();
    }

    // 抓所有全局 provide/inject 值
    const ctx = root._context;
    if (ctx && ctx.config && ctx.config.globalProperties) {
      const all = ctx.config.globalProperties;
      for (const k of Object.keys(all)) {
        const v = all[k];
        if (v && typeof v === 'function' && /axios|fetch|get|post/i.test(v.toString().slice(0, 200))) {
          out['fn_' + k] = v.toString().slice(0, 1000);
        }
      }
    }

    // 抓 __app__ 根实例 setup state
    try {
      const setup = root._instance?.setupState;
      if (setup) {
        out.setup = Object.keys(setup).slice(0, 50);
        for (const k of Object.keys(setup).slice(0, 20)) {
          const v = setup[k];
          if (v && typeof v === 'object' && Object.keys(v).length > 0) {
            out['setup_' + k] = Object.keys(v).slice(0, 10);
          }
        }
      }
    } catch (e) { out.setupErr = e.message; }

    return out;
  });
  console.log('=== apiResult.setup:', apiResult.setup);
  console.log('=== apiResult keys:', Object.keys(apiResult).filter(k => !k.startsWith('_')).join(', '));

  // 直接访问 vod 列表 API（在浏览器里）
  console.log('\n=== call /v1/vod directly ===');
  const direct = await page.evaluate(async () => {
    // 找 axios 或 fetch
    // 1. 直接 fetch /v1/vod?c=1&sort=new&page=1&limit=5
    const r = await fetch('/v1/vod?c=1&sort=new&page=1&limit=5', { headers: { 'Accept': 'application/json' } });
    const j = await r.json();
    return { status: r.status, ct: r.headers.get('content-type'), data: j };
  });
  console.log('=== /v1/vod status:', direct.status, 'data keys:', Object.keys(direct.data || {}));
  if (direct.data) {
    console.log('  data.data len:', direct.data.data?.length, 'data.key len:', direct.data.key?.length);
  }

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
