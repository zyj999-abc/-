// 第十八轮：抓所有响应头 + cookie + 找 key 字段
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v18';
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

  // 抓所有 XHR 响应头 + 完整 body
  const allXhr = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('quradpk')) return;
    if (!/\.js$|\.html$|\.css$/.test(u) && !u.includes('v1/')) {
      const req = res.request();
      if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
        try {
          const ct = res.headers()['content-type'] || '';
          let body = null;
          if (ct.includes('json')) {
            const buf = await res.buffer();
            body = buf.toString('utf-8');
          }
          allXhr.push({
            url: u,
            method: req.method(),
            status: res.status(),
            reqHeaders: req.headers(),
            resHeaders: res.headers(),
            body,
            cookies: await ctx.cookies(u),
          });
        } catch (e) {}
      }
    }
  });

  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);

  // 抓所有 cookie
  const cookies = await ctx.cookies();
  fs.writeFileSync(path.join(OUT, '1_xhr_full.json'), JSON.stringify(allXhr, null, 2));
  fs.writeFileSync(path.join(OUT, '1_cookies.json'), JSON.stringify(cookies, null, 2));
  console.log('=== XHR count:', allXhr.length);
  allXhr.forEach((x, i) => {
    console.log(' #' + i, x.method, x.status, x.url.slice(0, 100));
    if (x.body && x.body.length < 300) console.log('    body:', x.body);
    // 找 key 字段
    try {
      const j = JSON.parse(x.body || '{}');
      if (j.key) console.log('    [KEY]', j.key);
      if (j.data) console.log('    [data len]', j.data.length);
    } catch (e) {}
    // 找 set-cookie
    const sc = x.resHeaders['set-cookie'];
    if (sc) console.log('    [set-cookie]', sc);
  });
  console.log('=== cookies:', cookies.length);
  cookies.forEach(c => console.log(' ', c.name, '=', c.value.slice(0, 100), 'domain=' + c.domain));

  // 抓所有 _x07 localStorage 缓存（已解密的数据）
  const ls2 = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  fs.writeFileSync(path.join(OUT, '2_ls.json'), JSON.stringify(ls2, null, 2));

  // 访问 vod 列表 API 并打印完整 body
  console.log('\n=== call /v1/vod?c=10&sort=new&page=1 ===');
  const r = await page.evaluate(async () => {
    const res = await fetch('/v1/vod?c=10&sort=new&page=1&limit=5');
    const j = await res.json();
    return {
      status: res.status,
      headers: Array.from(res.headers.entries()),
      body: j,
    };
  });
  fs.writeFileSync(path.join(OUT, '3_vod_raw.json'), JSON.stringify(r, null, 2));
  console.log('=== vod status:', r.status);
  console.log('=== vod headers:', r.headers.slice(0, 20));
  console.log('=== vod body keys:', Object.keys(r.body || {}));
  if (r.body) {
    console.log('  data len:', r.body.data?.length, 'key len:', r.body.key?.length, 'k:', r.body.key);
  }

  // 试 /v1/yp?c=10 详情
  console.log('\n=== /v1/yp?c=10&t=zy&at=0&page=1 ===');
  const r2 = await page.evaluate(async () => {
    const res = await fetch('/v1/yp?c=10&t=zy&at=0&page=1');
    const j = await res.json();
    return { status: res.status, body: j };
  });
  fs.writeFileSync(path.join(OUT, '4_yp_raw.json'), JSON.stringify(r2, null, 2));
  console.log('=== yp body keys:', Object.keys(r2.body || {}));
  if (r2.body) {
    console.log('  data len:', r2.body.data?.length, 'key len:', r2.body.key?.length, 'k:', r2.body.key);
  }

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
