// 第十轮：抓真实视频 m3u8 流
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_video';
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

  // 抓 m3u8 / .ts / .mp4
  const mediaUrls = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (/\.(m3u8|ts|m4s|mp4|mp3|aac)(\?|$)/.test(u) || u.includes('m3u8')) {
      mediaUrls.push({ url: u, status: res.status(), ct: res.headers()['content-type'] });
      console.log('  [MEDIA]', res.status(), u);
    }
  });

  // 抓所有 API
  await page.evaluateOnNewDocument(() => {
    window.__XHR__ = [];
    const XO = window.XMLHttpRequest.prototype.open;
    const XS = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function(m, u) { this.__url = u; return XO.apply(this, arguments); };
    window.XMLHttpRequest.prototype.send = function() {
      this.addEventListener('readystatechange', function() {
        if (this.readyState === 4) {
          try {
            const ct = this.getResponseHeader('content-type') || '';
            if (ct.includes('json')) {
              window.__XHR__.push({ url: this.__url, body: JSON.parse(this.responseText) });
            }
          } catch (e) {}
        }
      });
      return XS.apply(this, arguments);
    };
  });

  // 找首页第一个视频项的 URL
  console.log('=== load homepage, get video card links ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(8000);

  // 抓所有 blob (图片)
  const blobs = await page.evaluate(() => {
    return window.__BLOBS__ || [];
  });
  console.log('  total blobs:', blobs.length);

  // 抓所有 a 链接（不限可见性）
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(h => h.includes('/v/') || h.includes('play') || h.includes('detail') || h.includes('video'))
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 30);
  });
  console.log('  video links:', links.length);
  links.forEach(l => console.log('   ', l));

  // 也看所有 a 不限
  const allLinks2 = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter((v, i, a) => a.indexOf(v) === i)
      .filter(h => h.startsWith('https://www.quradpk.com:2087/'))
      .filter(h => !h.includes('?') && h.split('/').length <= 6)
      .slice(0, 50);
  });
  console.log('  all internal links:');
  allLinks2.forEach(l => console.log('   ', l));

  // 访问 /v/1, /v/2 等不同 ID
  for (let id = 1; id <= 5; id++) {
    console.log('\\n=== try /v/' + id + ' ===');
    mediaUrls.length = 0;
    try {
      await page.goto('https://www.quradpk.com:2087/v/' + id, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(5000);
      const t = await page.title();
      const bodyLen = await page.evaluate(() => (document.body?.innerText || '').length);
      console.log('  title:', t, 'bodyLen:', bodyLen);
      if (t.includes('404') || bodyLen < 50) continue;

      // 抓 video 标签
      const vids = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('video')).map(v => ({
          src: v.src, currentSrc: v.currentSrc, poster: v.poster,
          sources: Array.from(v.querySelectorAll('source')).map(s => ({ src: s.src, type: s.type })),
        }));
      });
      console.log('  videos:', vids.length);
      vids.forEach((v, i) => console.log('   vid#' + i, JSON.stringify(v).slice(0, 300)));
      if (vids.length > 0) {
        fs.writeFileSync(path.join(OUT, 'v_' + id + '_videos.json'), JSON.stringify(vids, null, 2));
      }
      console.log('  mediaUrls seen:', mediaUrls.length);
      mediaUrls.slice(0, 5).forEach(m => console.log('   M', m.url));
      if (vids.length > 0) break;
    } catch (e) { console.log('  err:', e.message); }
  }

  // 试 /play?id=
  for (const path of ['/play/1', '/play/2', '/vplay/1', '/vplay?id=1', '/play?id=1', '/video/1']) {
    try {
      console.log('\\n=== try', path);
      await page.goto('https://www.quradpk.com:2087' + path, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await sleep(3000);
      const t = await page.title();
      const vids = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc));
      console.log('  title:', t, 'vids:', vids.length, vids.slice(0, 3));
      if (vids.length > 0) {
        console.log('  FOUND VIDEO PATH:', path);
        break;
      }
    } catch (e) {}
  }

  await browser.close();
  console.log('\\n=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
