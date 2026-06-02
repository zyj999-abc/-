// 第四轮：在浏览器里跑实际解密，把结果 base64 编码写文件
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_dec';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const B64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...args) => console.log(args.map(a => typeof a === 'string' ? B64(a) : a).join(' | '));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--ignore-certificate-errors', '--lang=zh-CN,zh', '--window-size=1280,800'],
  });
  const ctx = await browser.createBrowserContext();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
  const page = await ctx.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // ===== 1. 抓首页 + 抓 blist 加密响应 =====
  log('=== STAGE 1: visit quradpk homepage ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // 抓 blist 真实响应 + 在浏览器里 fetch + 解密
  const dec = await page.evaluate(async () => {
    const out = {};
    out.url = location.href;
    out.title = document.title;

    // 1. 抓首屏"今日推荐"列表（已显示的视频）
    const cards = Array.from(document.querySelectorAll('a[href*="/v_play"],a[href*="/video"],a[href*="play"]'))
      .map(a => ({ href: a.href, text: (a.innerText || '').slice(0, 80) }))
      .filter(x => x.text);
    out.cards = cards.slice(0, 20);

    // 2. 抓页面所有 a 链接
    out.allLinks = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href).filter(h => !h.startsWith('data:') && !h.startsWith('javascript:'))
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 60);

    // 3. 抓分类菜单链接
    out.menu = Array.from(document.querySelectorAll('.menu a, .nav a, .side a, [class*="menu"] a, [class*="cate"] a'))
      .map(a => ({ href: a.href, text: a.innerText?.slice(0, 20) }))
      .filter(x => x.text && x.href).slice(0, 30);

    // 4. 抓 XHR 加密响应：直接 fetch blist 看
    try {
      const r1 = await fetch('/v1/blist?c=0');
      out.blistRaw = await r1.text();
    } catch (e) { out.blistErr = e.message; }

    try {
      const r2 = await fetch('/v1/tags?c=0&v=2');
      out.tagsRaw = await r2.text();
    } catch (e) { out.tagsErr = e.message; }

    try {
      const r3 = await fetch('/v1/vod_category?c=0');
      out.catsRaw = await r3.text();
    } catch (e) { out.catsErr = e.message; }

    // 5. 抓页面里暴露的 window 全局（看是否有解密 key）
    out.windowKeys = Object.keys(window).filter(k =>
      k.length < 20 && /[A-Z]/.test(k[0])
    ).slice(0, 100);

    return out;
  });
  fs.writeFileSync(path.join(OUT, '1_home.json'), JSON.stringify(dec, null, 2));
  log('  saved 1_home.json, cards:', dec.cards?.length, 'allLinks:', dec.allLinks?.length);
  log('  blistRaw len:', dec.blistRaw?.length, 'tagsRaw len:', dec.tagsRaw?.length);

  // ===== 2. 在浏览器里实际解密 API =====
  log('=== STAGE 2: decrypt APIs in browser ===');

  // 让浏览器加载主 bundle 然后尝试解密
  // 但 v1/blist 等 API 返回的 data+key 都加密了，需要前端解密函数
  // 我们直接在浏览器里 eval 一个解密脚本：
  const dec2 = await page.evaluate(async () => {
    const out = {};

    // 1. 抓 main bundle 的所有字符串，找 aes key/sm4
    const scripts = Array.from(document.scripts).map(s => s.src).filter(Boolean);

    // 2. 看是否有全局暴露的解密函数
    out.globals = {
      sm4: typeof window.sm4,
      crypto: typeof window.crypto,
      CryptoJS: typeof window.CryptoJS,
      forge: typeof window.forge,
      hex_md5: typeof window.hex_md5,
      __toCdnUrl: typeof window.__toCdnUrl,
    };

    // 3. fetch blist 然后试各种方式解密
    const blistRaw = await fetch('/v1/blist?c=0').then(r => r.json());
    out.blistJson = blistRaw;

    // 4. 试 AES-CBC 用 key 作为密钥对 data 解密
    const tryDec = async (data, key, algo) => {
      try {
        const enc = new TextEncoder();
        // base64 -> bytes
        const ct = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const k = Uint8Array.from(atob(key), c => c.charCodeAt(0));
        // AES-CBC + PKCS7
        const iv = ct.slice(0, 16);
        const body = ct.slice(16);
        const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-CBC' }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, body);
        return new TextDecoder().decode(pt);
      } catch (e) {
        return 'err: ' + e.message;
      }
    };

    // key 是 base64，data 是 base64
    out.tryAesKey = await tryDec(blistRaw.data, blistRaw.key, 'AES-CBC');
    out.tryAesDataAsKey = await tryDec(blistRaw.key, blistRaw.data, 'AES-CBC');

    // 5. 试 key 当 IV
    try {
      const ct = Uint8Array.from(atob(blistRaw.data), c => c.charCodeAt(0));
      const k = Uint8Array.from(atob(blistRaw.key), c => c.charCodeAt(0));
      const iv = k.slice(0, 16);
      const body = ct;
      const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-CBC' }, false, ['decrypt']);
      const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, body);
      out.tryAesIvFromKey = new TextDecoder().decode(pt);
    } catch (e) { out.tryAesIvFromKey = 'err: ' + e.message; }

    // 6. 试 key 直接当 AES key
    try {
      const ct = Uint8Array.from(atob(blistRaw.data), c => c.charCodeAt(0));
      const k = Uint8Array.from(atob(blistRaw.key), c => c.charCodeAt(0));
      // 取 key 前 16 字节当 AES-128 key
      const iv = new Uint8Array(16);
      const body = ct;
      const ck = await crypto.subtle.importKey('raw', k.slice(0, 16), { name: 'AES-CBC' }, false, ['decrypt']);
      const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, body);
      out.tryAes128Key = new TextDecoder().decode(pt);
    } catch (e) { out.tryAes128Key = 'err: ' + e.message; }

    // 7. 试 SM4-CBC (国密) - 浏览器没有原生 SM4
    // 但前端若用 sm-crypto / gm-crypto 会有 sm4
    return out;
  });
  fs.writeFileSync(path.join(OUT, '2_decrypt.json'), JSON.stringify(dec2, null, 2));
  log('  saved 2_decrypt.json');
  log('  blistJson data len:', dec2.blistJson?.data?.length, 'key len:', dec2.blistJson?.key?.length);
  log('  tryAesKey (前 60):', String(dec2.tryAesKey).slice(0, 60));
  log('  tryAesDataAsKey (前 60):', String(dec2.tryAesDataAsKey).slice(0, 60));
  log('  tryAesIvFromKey (前 60):', String(dec2.tryAesIvFromKey).slice(0, 60));
  log('  tryAes128Key (前 60):', String(dec2.tryAes128Key).slice(0, 60));

  // ===== 3. 抓 video-play bundle 找解密函数 =====
  log('=== STAGE 3: load all bundles to find decrypt func ===');
  // 主入口 index bundle 已知包含路由，要抓的就是它的内容
  // 但解密函数可能在 video-play 单独 bundle 中
  // 我们先看 index bundle 是否暴露了函数

  // 让浏览器把当前 main bundle 的 source 保存到 localStorage
  const idx = await page.evaluate(async () => {
    // 抓所有 module import paths
    const out = {};
    try {
      // 找页面里所有动态加载过的 js
      const r = performance.getEntriesByType('resource').filter(e => e.name.includes('.js'));
      out.jsResources = r.map(e => e.name).slice(0, 30);
    } catch (e) { out.err = e.message; }
    return out;
  });
  fs.writeFileSync(path.join(OUT, '3_resources.json'), JSON.stringify(idx, null, 2));
  log('  jsResources:', idx.jsResources?.length);

  // ===== 4. 试一次具体视频访问，找真实源 URL =====
  log('=== STAGE 4: try visit video page ===');
  // 抓首页任意一个视频详情
  const firstCard = dec.cards?.[0];
  if (firstCard) {
    log('  firstCard href:', firstCard.href);
    try {
      await page.goto(firstCard.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(5000);
      const vd = await page.evaluate(() => {
        return {
          url: location.href,
          title: document.title,
          bodyText: (document.body?.innerText || '').slice(0, 1500),
          videos: Array.from(document.querySelectorAll('video')).map(v => ({
            src: v.src,
            currentSrc: v.currentSrc,
            sources: Array.from(v.querySelectorAll('source')).map(s => ({ src: s.src, type: s.type })),
            poster: v.poster,
          })),
          iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src).slice(0, 10),
        };
      });
      fs.writeFileSync(path.join(OUT, '4_video_detail.json'), JSON.stringify(vd, null, 2));
      log('  saved 4_video_detail.json');
      log('  title:', vd.title);
      log('  bodyText len:', vd.bodyText.length, 'first 100:', vd.bodyText.slice(0, 100));
      log('  videos count:', vd.videos.length);
      vd.videos.forEach((v, i) => log('  video#' + i, JSON.stringify(v)));
    } catch (e) { log('  video err:', e.message); }
  } else {
    log('  no firstCard');
    // 直接试一些路径
    for (const p of ['/v/1', '/vplay/1', '/video/1', '/play?id=1']) {
      try {
        await page.goto('https://www.quradpk.com:2087' + p, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await sleep(3000);
        const t = await page.title();
        if (!t.includes('404')) {
          log('  found at:', p, 'title:', t);
          break;
        }
      } catch (e) {}
    }
  }

  await browser.close();
  log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
