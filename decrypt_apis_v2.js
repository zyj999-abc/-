// 第五轮：尝试各种 AES 解密 + 抓真实视频页
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_dec2';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const B64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...args) => console.log(args.map(a => typeof a === 'string' ? B64(a) : a).join(' | '));

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

  log('=== visit quradpk ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // ===== 1. 暴力尝试各种 AES-256-CBC 解密 =====
  log('=== STAGE 1: brute force AES decrypt ===');
  const dec = await page.evaluate(async () => {
    const out = {};
    const r = await fetch('/v1/blist?c=0').then(r => r.json());
    out.dataB64 = r.data;
    out.keyB64 = r.key;

    const key = Uint8Array.from(atob(r.key), c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
    out.keyLen = key.length;
    out.dataLen = data.length;

    const tryDec = async (keyBuf, ivBuf, bodyBuf, algo = 'AES-CBC') => {
      try {
        const ck = await crypto.subtle.importKey('raw', keyBuf, { name: algo }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: algo, iv: ivBuf }, ck, bodyBuf);
        return new TextDecoder().decode(pt);
      } catch (e) { return 'ERR:' + e.message; }
    };

    // 试 1: key=key, iv=data前16, body=data
    out.k1 = await tryDec(key, data.slice(0, 16), data.slice(16));
    // 试 2: key=key, iv=0, body=data
    out.k2 = await tryDec(key, new Uint8Array(16), data);
    // 试 3: key=key, iv=key前16, body=data
    out.k3 = await tryDec(key, key.slice(0, 16), data);
    // 试 4: data=key, key=data前16, iv=0
    out.k4 = await tryDec(data.slice(0, 16), new Uint8Array(16), data.slice(16));
    // 试 5: data=key, key=data前32, iv=0
    out.k5 = await tryDec(data.slice(0, 32), new Uint8Array(16), data.slice(32));
    // 试 6: key=data, iv=0, body=key (反向)
    out.k6 = await tryDec(data, new Uint8Array(16), key);

    // 试 ECB 模式
    const tryECB = async (keyBuf, bodyBuf) => {
      try {
        const ck = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-ECB' }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-ECB' }, ck, bodyBuf);
        return new TextDecoder().decode(pt);
      } catch (e) { return 'ERR:' + e.message; }
    };
    out.e1 = await tryECB(key, data);
    out.e2 = await tryECB(data, key);

    // 试 GCM 模式
    const tryGCM = async (keyBuf, ivBuf, bodyBuf) => {
      try {
        const ck = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, ck, bodyBuf);
        return new TextDecoder().decode(pt);
      } catch (e) { return 'ERR:' + e.message; }
    };
    out.g1 = await tryGCM(key, data.slice(0, 12), data.slice(12));

    // 试 SM4 (国密) - 浏览器没有原生的，但前端 bundle 可能用 sm-crypto
    // 先看页面是否有 sm-crypto
    out.sm4Scripts = Array.from(document.scripts).map(s => s.src).filter(s => /sm|gm|crypto/i.test(s));

    return out;
  });
  fs.writeFileSync(path.join(OUT, '1_decrypt_attempts.json'), JSON.stringify(dec, null, 2));
  log('  keyLen:', dec.keyLen, 'dataLen:', dec.dataLen);
  ['k1','k2','k3','k4','k5','k6','e1','e2','g1'].forEach(k => {
    const v = dec[k] || '';
    log('  ' + k + ' (前 100):', String(v).slice(0, 100));
  });

  // ===== 2. 抓前端 bundle 找 SM4 / 真正解密函数 =====
  log('=== STAGE 2: look for SM4 in bundles ===');

  // 抓 video-play bundle: 它包含 video 列表的解密逻辑
  // 主 bundle 是 /assets/t1/static/index-C8_2Ry-F.js
  // 从 index bundle 引用 video-play-BGbcD5_s.js
  // 我们在浏览器里直接 fetch 它
  const bundle = await page.evaluate(async () => {
    const out = {};
    // 先抓 main bundle 找 __toCdnUrl
    const cdnUrl = window.__toCdnUrl ? window.__toCdnUrl('/assets/t1/static/index-C8_2Ry-F.js') : null;
    out.cdnUrl = cdnUrl;

    // 试一下直接 fetch video-play bundle
    if (cdnUrl) {
      try {
        const base = cdnUrl.replace('/index-C8_2Ry-F.js', '');
        const r = await fetch(base + '/video-play-BGbcD5_s.js');
        out.videoPlay = await r.text();
        out.videoPlayLen = out.videoPlay.length;
      } catch (e) { out.err = e.message; }
    }
    return out;
  });
  if (bundle.videoPlay) {
    fs.writeFileSync(path.join(OUT, '2_video_play_bundle.js'), bundle.videoPlay);
    log('  video-play bundle saved, len:', bundle.videoPlayLen);
    // 找 sm4/aes/decrypt 字样
    const matches = bundle.videoPlay.match(/(sm4|sm-crypto|gm-crypto|aes|crypto-js|CryptoJS|decrypt|new\s+function|return\s*function[^{]*\([^{]*\)\s*\{)/gi);
    log('  keyword matches:', matches?.slice(0, 30).join(' | '));
  } else {
    log('  no videoPlay bundle');
  }

  // ===== 3. 抓 categories 列表，然后访问真实视频 =====
  log('=== STAGE 3: try visit /v/list or use ID-based URL ===');

  // quradpk 是 Vue Router，路由 hash 模式或者 history 模式？
  // 看 main bundle 找路由表
  // 已经看到模块名 video-play-BGbcD5_s.js, video-category-32hU62DB.js
  // 试这些路径
  const paths = [
    '/v/list', '/v/category', '/v/play/1', '/vplay/1', '/v/1', '/v_detail/1',
    '/novel/list', '/novel/1', '/comic/list', '/comic/1', '/actress/1',
    '/category/1', '/list/1', '/play/1.html',
  ];
  const found = [];
  for (const p of paths) {
    try {
      await page.goto('https://www.quradpk.com:2087' + p, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await sleep(2000);
      const t = await page.title();
      if (!t.includes('404') && !t.includes('不存在')) {
        const html = await page.content();
        const len = html.length;
        const has404 = html.includes('404') && html.includes('不存在');
        if (!has404) {
          log('  [OK]', p, 'title:', t, 'len:', len);
          found.push({ p, t, len });
        }
      }
    } catch (e) {}
  }
  fs.writeFileSync(path.join(OUT, '3_visited.json'), JSON.stringify(found, null, 2));

  // ===== 4. 抓 main bundle 解析路由 =====
  log('=== STAGE 4: parse main bundle routes ===');
  const main = await page.evaluate(async () => {
    const r = await fetch(window.__toCdnUrl('/assets/t1/static/index-C8_2Ry-F.js'));
    const t = await r.text();
    return { len: t.length, sample: t.slice(0, 500) };
  });
  log('  main bundle len:', main.len);

  // 找 router 相关
  if (main.len > 0) {
    // main bundle 是 route table 入口，太大
    // 我们之前 track 1 时已经抓到了 resp_18 (340KB main bundle)
    // 重新找路由表
    const mainTxt = fs.readFileSync('/tmp/17c_track/resp_18_https___ghj7saa.xn--54qu66awkkshgsf475q.com_assets_t1_static_index_C8_2Ry_F.js.js', 'utf-8');
    // 找路径常量
    const routeMatches = mainTxt.match(/["']\/v[\w/-]*["']|["']\/novel[\w/-]*["']|["']\/comic[\w/-]*["']|["']\/actress[\w/-]*["']/g);
    log('  routes in main bundle:', routeMatches?.slice(0, 30).join(' '));
    fs.writeFileSync(path.join(OUT, '4_routes.json'), JSON.stringify([...new Set(routeMatches || [])], null, 2));
  }

  await browser.close();
  log('=== DONE ===');
})().catch(e => { log('FATAL:', e.message); process.exit(1); });
