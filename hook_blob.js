// 第九轮：hook URL.createObjectURL 拿真实图片二进制 + 抓所有 API 已解密的 data
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_blob';
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

  // 注入 hook
  await page.evaluateOnNewDocument(() => {
    window.__BLOBS__ = [];
    window.__DECRYPTED__ = [];

    // 1. Hook URL.createObjectURL 把 blob 转 base64
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function(blob) {
      if (blob instanceof Blob) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result || '').toString().split(',')[1] || '';
          window.__BLOBS__.push({
            t: Date.now(),
            size: blob.size,
            type: blob.type,
            b64: b64.slice(0, 200000), // 200KB 截断
          });
          if (window.__BLOBS__.length > 50) window.__BLOBS__ = window.__BLOBS__.slice(-50);
        };
        reader.readAsDataURL(blob);
      }
      return origCreate.apply(this, arguments);
    };

    // 2. Hook fetch 拿所有响应 body
    const realFetch = window.fetch;
    window.fetch = async function(input, init) {
      const u = typeof input === 'string' ? input : input.url;
      const r = await realFetch.apply(this, arguments);
      try {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const clone = r.clone();
          const body = await clone.json();
          window.__DECRYPTED__.push({ t: Date.now(), url: u, body });
          if (window.__DECRYPTED__.length > 100) window.__DECRYPTED__ = window.__DECRYPTED__.slice(-100);
        }
      } catch (e) {}
      return r;
    };
  });

  // 抓所有页面请求
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('quradpk') || u.includes('xn--')) {
      console.log('  [REQ]', req.method(), u.replace('https://www.quradpk.com:2087', ''));
    }
  });

  // ===== 1. 访问首页 =====
  console.log('=== visit homepage ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);

  const r1 = await page.evaluate(() => ({
    blobs: window.__BLOBS__ || [],
    apis: (window.__DECRYPTED__ || []).map(d => ({
      url: d.url.replace('https://www.quradpk.com:2087', ''),
      data: d.body,
    })),
  }));
  fs.writeFileSync(path.join(OUT, '1_home_data.json'), JSON.stringify(r1, null, 2));
  console.log('  blobs count:', r1.blobs.length);
  console.log('  apis count:', r1.apis.length);
  r1.blobs.slice(0, 5).forEach((b, i) => {
    console.log('  blob #' + i + ' size:', b.size, 'type:', b.type, 'b64 len:', b.b64.length);
  });

  // 把每张图片的 base64 单独存
  r1.blobs.forEach((b, i) => {
    try {
      const buf = Buffer.from(b.b64, 'base64');
      const ext = b.type.includes('gif') ? '.gif' : b.type.includes('png') ? '.png' : b.type.includes('jpeg') || b.type.includes('jpg') ? '.jpg' : '.bin';
      fs.writeFileSync(path.join(OUT, 'blob_' + i + '_' + b.size + ext), buf);
    } catch (e) {}
  });

  // ===== 2. 抓 novel/1 详细数据 =====
  console.log('=== visit /novel/1 ===');
  await page.evaluate(() => { window.__BLOBS__ = []; window.__DECRYPTED__ = []; });
  await page.goto('https://www.quradpk.com:2087/novel/1', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);
  const r2 = await page.evaluate(() => ({
    blobs: window.__BLOBS__,
    apis: window.__DECRYPTED__.map(d => ({ url: d.url.replace('https://www.quradpk.com:2087', ''), data: d.body })),
  }));
  fs.writeFileSync(path.join(OUT, '2_novel_data.json'), JSON.stringify(r2, null, 2));
  console.log('  blobs:', r2.blobs.length, 'apis:', r2.apis.length);
  r2.blobs.slice(0, 3).forEach((b, i) => {
    console.log('  novel blob #' + i + ' size:', b.size, 'type:', b.type);
    const buf = Buffer.from(b.b64, 'base64');
    const ext = b.type.includes('gif') ? '.gif' : b.type.includes('png') ? '.png' : b.type.includes('jpeg') ? '.jpg' : '.bin';
    fs.writeFileSync(path.join(OUT, 'novel_blob_' + i + '_' + b.size + ext), buf);
  });

  // ===== 3. 抓 category/1 (视频) =====
  console.log('=== visit /category/1 ===');
  await page.evaluate(() => { window.__BLOBS__ = []; window.__DECRYPTED__ = []; });
  await page.goto('https://www.quradpk.com:2087/category/1', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);
  const r3 = await page.evaluate(() => ({
    blobs: window.__BLOBS__,
    apis: window.__DECRYPTED__.map(d => ({ url: d.url.replace('https://www.quradpk.com:2087', ''), data: d.body })),
  }));
  fs.writeFileSync(path.join(OUT, '3_category_data.json'), JSON.stringify(r3, null, 2));
  console.log('  blobs:', r3.blobs.length, 'apis:', r3.apis.length);
  r3.blobs.slice(0, 3).forEach((b, i) => {
    console.log('  category blob #' + i + ' size:', b.size, 'type:', b.type);
    const buf = Buffer.from(b.b64, 'base64');
    const ext = b.type.includes('gif') ? '.gif' : b.type.includes('png') ? '.png' : b.type.includes('jpeg') ? '.jpg' : '.bin';
    fs.writeFileSync(path.join(OUT, 'category_blob_' + i + '_' + b.size + ext), buf);
  });

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
