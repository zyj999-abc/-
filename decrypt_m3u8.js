// 第二十八轮：解密 /v1/vod/play?id=254023 拿 m3u8 源
const JSEncrypt = require('jsencrypt');
const cryptoJS = require('crypto-js');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const code = fs.readFileSync('/workspace/legacy.js', 'utf-8');
const pub = code.match(/MIIB[A-Za-z0-9+/=]{50,}/)[0];
const crypt = new JSEncrypt();
crypt.setPublicKey(pub);

const decryptItem = (item) => {
  if (!item || !item.data || !item.key) return null;
  try {
    const aesK = crypt.decrypt(item.key);
    if (!aesK) return null;
    const nArr = aesK.split('');
    nArr.reverse();
    const iv = nArr.join('').substring(0, 16);
    const dec = cryptoJS.AES.decrypt(item.data, cryptoJS.enc.Utf8.parse(aesK), {
      iv: cryptoJS.enc.Utf8.parse(iv),
      padding: cryptoJS.pad.Pkcs7,
    });
    return cryptoJS.enc.Utf8.stringify(dec);
  } catch (e) { return 'ERR: ' + e.message; }
};

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

  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // 调所有视频相关 API + 解密
  const apis = await page.evaluate(async () => {
    const fetchers = [
      // 视频详情
      ['vod/254023', '/v1/vod/254023?c=10'],
      // 视频播放
      ['vod/play', '/v1/vod/play?id=254023&c=10'],
      // 影片详情
      ['yp/254023', '/v1/yp/254023?c=10'],
      // 影片播放
      ['yp/play', '/v1/yp/play?id=254023&c=10'],
      // 试试别的格式
      ['vod/info', '/v1/vod/info?c=10&id=254023'],
      ['vod/detail', '/v1/vod/detail?c=10&id=254023'],
      // 视频流地址（猜测）
      ['play_url', '/v1/vod/play_url?c=10&id=254023'],
      ['video_url', '/v1/video/254023?c=10'],
    ];
    const out = {};
    for (const [name, url] of fetchers) {
      try {
        const r = await fetch(url);
        out[name] = { status: r.status, ct: r.headers.get('content-type'), body: await r.json() };
      } catch (e) { out[name] = { err: e.message }; }
    }
    return out;
  });

  console.log('=== API results:');
  for (const k of Object.keys(apis)) {
    const v = apis[k];
    if (v.status) {
      console.log(k, ':', v.status, 'data?', !!v.body?.data, 'key?', !!v.body?.key);
      if (v.body?.data) {
        const dec = decryptItem(v.body);
        console.log('  decrypted (前 1500):');
        console.log(dec?.slice(0, 1500));
        console.log('');
      }
    } else {
      console.log(k, ': ERR', v.err);
    }
  }

  // 抓 m3u8 响应
  const media = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('m3u8') || u.includes('.ts') || u.includes('auth_key')) {
      try {
        const buf = await res.buffer();
        media.push({ url: u, status: res.status(), size: buf.length, body: buf.toString('utf-8').slice(0, 10000) });
        console.log('  [MEDIA]', res.status(), u);
      } catch (e) {}
    }
  });

  // 访问带 video id 的页面
  console.log('\n=== visit /yp/254023 and watch for m3u8 ===');
  media.length = 0;
  try {
    await page.goto('https://www.quradpk.com:2087/yp/254023', { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(12000);
    console.log('  media count:', media.length);
    media.slice(0, 10).forEach(m => console.log('   M', m.url.slice(0, 200), '\n     body:', m.body?.slice(0, 200)));
  } catch (e) { console.log('  err:', e.message); }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
