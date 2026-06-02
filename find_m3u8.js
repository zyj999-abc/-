// 第二十七轮：抓真实视频 m3u8 源
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_m3u8';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--ignore-certificate-errors', '--lang=zh-CN,zh', '--window-size=1280,800'],
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // 抓 m3u8 / .ts / .mp4
  const media = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (/\.(m3u8|ts|m4s|mp4)(\?|$)/.test(u) || u.includes('m3u8') || u.includes('auth_key')) {
      try {
        const buf = await res.buffer();
        const body = buf.toString('utf-8').slice(0, 20000);
        media.push({ url: u, status: res.status(), size: buf.length, ct: res.headers()['content-type'], body });
        console.log('  [MEDIA]', res.status(), u, 'size:', buf.length);
      } catch (e) {
        media.push({ url: u, status: res.status(), err: e.message });
      }
    }
  });

  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // 调用 API 拿视频详情 ID 254023
  const r = await page.evaluate(async () => {
    // 试 /v1/vod/{id} 详情
    const tryUrls = [
      '/v1/vod/254023?c=10',
      '/v1/vod/info?id=254023&c=10',
      '/v1/vod/play?id=254023&c=10',
      '/v1/vod/detail?id=254023&c=10',
    ];
    const out = {};
    for (const u of tryUrls) {
      try {
        const r = await fetch(u);
        out[u] = { status: r.status, body: await r.text() };
      } catch (e) { out[u] = { err: e.message }; }
    }
    // 试 GET /v1/yp/{id}
    const ypUrls = ['/v1/yp/254023?c=10', '/v1/yp/info?c=10&id=254023', '/v1/yp/detail?c=10&id=254023'];
    for (const u of ypUrls) {
      try {
        const r = await fetch(u);
        out[u] = { status: r.status, body: await r.text() };
      } catch (e) { out[u] = { err: e.message }; }
    }
    return out;
  });
  console.log('=== API results:');
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (v.status) console.log(' ', v.status, k, '->', v.body?.slice(0, 200));
    else console.log(' ERR', k, v.err);
  }

  // 访问 /yp/254023
  console.log('\n=== visit /yp/254023 ===');
  media.length = 0;
  try {
    await page.goto('https://www.quradpk.com:2087/yp/254023', { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(10000);
    const t = await page.title();
    console.log('  title:', t);
    const vids = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => ({
      src: v.src, currentSrc: v.currentSrc, poster: v.poster,
    })));
    console.log('  videos:', vids.length);
    vids.forEach(v => console.log('   vid', JSON.stringify(v)));
    console.log('  media:', media.length);
    media.slice(0, 10).forEach(m => {
      console.log('   M', m.url.slice(0, 200), 'body:', m.body?.slice(0, 200));
    });
  } catch (e) { console.log('  err:', e.message); }

  // 访问 /yp/play?id=254023 或 /v/play?id=254023
  const tryPaths = ['/yp/play/254023', '/v/play/254023', '/play/254023', '/v/254023', '/video/254023', '/yp/play?id=254023', '/v/play?id=254023'];
  for (const p of tryPaths) {
    console.log('\n=== try', p);
    media.length = 0;
    try {
      await page.goto('https://www.quradpk.com:2087' + p, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(8000);
      const t = await page.title();
      const vids = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc));
      console.log('  title:', t, 'vids:', vids.length);
      vids.forEach(v => console.log('   vid:', v));
      media.slice(0, 5).forEach(m => {
        console.log('   M:', m.url.slice(0, 200));
        if (m.body && m.body.length < 1000) console.log('    body:', m.body);
      });
      if (vids.length > 0 || media.some(m => m.url.includes('m3u8'))) {
        console.log('  [FOUND]');
        break;
      }
    } catch (e) { console.log('  err:', e.message); }
  }

  // 直接点击首页第一张图片的链接（m3u8 通过 onClick 触发）
  console.log('\n=== go back to home + click first video card ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(5000);
  // 在浏览器里模拟点击
  media.length = 0;
  await page.evaluate(() => {
    // 找第一张视频卡片
    const cards = document.querySelectorAll('a, li, [class*="card"], [class*="item"]');
    for (const c of cards) {
      const img = c.querySelector('img');
      if (img && img.src && img.src.includes('vod_en.jpg')) {
        // 点这个元素
        c.click();
        return true;
      }
    }
    return false;
  });
  await sleep(8000);
  const t2 = await page.title();
  const vids2 = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc));
  console.log('  title after click:', t2, 'vids:', vids2.length);
  vids2.forEach(v => console.log('   vid:', v));
  media.slice(0, 10).forEach(m => {
    console.log('   M:', m.url.slice(0, 200));
    if (m.body && m.body.length < 2000) console.log('    body:', m.body);
  });

  fs.writeFileSync(path.join(OUT, '_media.json'), JSON.stringify(media, null, 2));
  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
