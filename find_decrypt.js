// 第七轮：抓 novel-list bundle 找解密 + 抓真实图片 URL + 找视频源
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_dec3';
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

  // ===== 1. 在浏览器里 fetch novel-list + 实际解密 =====
  const dec = await page.evaluate(async () => {
    const out = {};
    const r1 = await fetch('/v1/novel?c=1&sort=4&limit=12');
    const j1 = await r1.json();
    out.novelRaw = JSON.stringify(j1).slice(0, 5000);

    // 找 window 上的 decrypt 函数
    out.windowFns = Object.keys(window).filter(k => /dec|descr|aes|sm4|key|secur/i.test(k)).slice(0, 20);

    // 抓 __vite__ 暴露的 module
    out.__vite__modules = window.__vite__ ? Object.keys(window.__vite__) : 'no __vite__';

    // 找页面里所有 import 的 module 名（从 main bundle parse）
    out.imports = (window.__toCdnUrl + '').slice(0, 200);

    // 抓页面所有图片的真实 URL（不靠 puppeteer 编码）
    out.imgs = Array.from(document.querySelectorAll('img')).map(i => ({
      src: i.getAttribute('src'),
      dataSrc: i.getAttribute('data-src'),
      lazy: i.getAttribute('data-original'),
      alt: i.alt,
    })).filter(i => i.src || i.dataSrc || i.lazy).slice(0, 20);

    return out;
  });
  fs.writeFileSync(path.join(OUT, '1_novel_decrypt.json'), JSON.stringify(dec, null, 2));
  console.log('=== imgs (原始 URL) ===');
  dec.imgs.forEach((i, idx) => console.log(' ', idx, JSON.stringify(i).slice(0, 200)));

  // ===== 2. 抓 main bundle 找 __vite__module 入口 =====
  const mainResp = await page.evaluate(async () => {
    const url = window.__toCdnUrl('/assets/t1/static/index-C8_2Ry-F.js');
    const r = await fetch(url);
    return await r.text();
  });
  fs.writeFileSync(path.join(OUT, '2_main_bundle.js'), mainResp);
  console.log('=== main bundle saved, len:', mainResp.length);

  // 找解密相关字符串
  const cryptoMatches = mainResp.match(/(AES|SM4|sm4|CryptoJS|decrypt|sm-crypto|gm-crypto|aesDecrypt|sm4Decrypt)[\s\S]{0,500}/g) || [];
  console.log('=== crypto matches in main bundle:', cryptoMatches.length);
  cryptoMatches.slice(0, 10).forEach((m, i) => console.log(' #' + i + ':', m.slice(0, 200)));

  // 找 routes (path:)
  const pathMatches = mainResp.match(/path:["']\/[^"']{0,40}["']/g) || [];
  console.log('=== path matches:', pathMatches.length);
  [...new Set(pathMatches)].slice(0, 30).forEach(p => console.log(' ', p));

  // 找 fetch 调用
  const fetchMatches = mainResp.match(/fetch\(\s*["'`][^"'`]{0,100}["'`]/g) || [];
  console.log('=== fetch URLs:', fetchMatches.length);
  [...new Set(fetchMatches)].slice(0, 20).forEach(f => console.log(' ', f));

  // 找 axios / get / post
  const apiMatches = mainResp.match(/["'`]\/v1\/[a-z_/]+["'`]/g) || [];
  console.log('=== API paths:', apiMatches.length);
  [...new Set(apiMatches)].slice(0, 30).forEach(f => console.log(' ', f));

  // ===== 3. 抓 novel-list bundle 找解密函数 =====
  console.log('=== STAGE 3: load novel-list bundle ===');
  const nl = await page.evaluate(async () => {
    try {
      const url = window.__toCdnUrl('/assets/t1/static/novel-list-67b59cnl.js');
      const r = await fetch(url);
      return await r.text();
    } catch (e) { return e.message; }
  });
  fs.writeFileSync(path.join(OUT, '3_novel_list_bundle.js'), nl);
  console.log('  novel-list bundle len:', nl.length);
  const cryptoInNl = nl.match(/(decrypt|aes|sm4|sm-crypto|gm-crypto|data\.data|data\.key|\.key|\.data)[\s\S]{0,300}/g) || [];
  console.log('  cryptoInNl:', cryptoInNl.slice(0, 5).map(m => m.slice(0, 200)));

  // ===== 4. 抓 novel-item bundle =====
  const ni = await page.evaluate(async () => {
    try {
      const url = window.__toCdnUrl('/assets/t1/static/novel-item-CsHd6PRz.js');
      const r = await fetch(url);
      return await r.text();
    } catch (e) { return e.message; }
  });
  fs.writeFileSync(path.join(OUT, '4_novel_item_bundle.js'), ni);
  console.log('  novel-item bundle len:', ni.length);

  // ===== 5. 找 section-cate 找视频 =====
  const sc = await page.evaluate(async () => {
    try {
      const url = window.__toCdnUrl('/assets/t1/static/section-cate-D90aoM7J.js');
      const r = await fetch(url);
      return await r.text();
    } catch (e) { return e.message; }
  });
  fs.writeFileSync(path.join(OUT, '5_section_cate_bundle.js'), sc);
  console.log('  section-cate bundle len:', sc.length);
  const scApi = sc.match(/["'`]\/v1\/[a-zA-Z0-9_/]+["'`]/g) || [];
  console.log('  sc APIs:', [...new Set(scApi)]);

  // ===== 6. 找 video-play / video-category 真实文件名 =====
  // 文件名带 hash，需要从 main bundle import 里找
  const importMatches = mainResp.match(/window\.__toCdnUrl\(\s*["'`]([^"'`]+)["'`]\s*\)/g) || [];
  console.log('=== all imports from main bundle:', importMatches.length);
  importMatches.forEach(i => console.log(' ', i));

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
