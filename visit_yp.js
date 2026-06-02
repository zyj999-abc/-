// 第十五轮：访问 /yp/{id} 抓 m3u8 真实 URL
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v15';
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

  const media = [];
  const xhr = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (/\.(m3u8|ts|m4s|mp4|aac|jpg|png|gif|webp)(\?|$)/.test(u) || u.includes('m3u8') || u.includes('auth_key') || u.includes('video/')) {
      try {
        const ct = res.headers()['content-type'] || '';
        let body = null;
        if (/json|text|javascript/.test(ct) || u.includes('m3u8')) {
          body = (await res.buffer()).toString('utf-8').slice(0, 50000);
        }
        media.push({ url: u, status: res.status(), size: res.headers()['content-length'] || 0, ct, body });
        console.log('  [RES]', res.status(), u.slice(0, 200));
      } catch (e) {}
    }
  });
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('v1/') || u.includes('m3u8') || u.includes('auth_key') || u.includes('video/')) {
      xhr.push({ method: req.method(), url: u });
    }
  });

  // 访问 /yp/{1,2,3,4,5,6,7,8,9,10}
  for (let id = 1; id <= 10; id++) {
    console.log('\n=== /yp/' + id);
    media.length = 0;
    xhr.length = 0;
    try {
      await page.goto('https://www.quradpk.com:2087/yp/' + id, { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(6000);

      const t = await page.title();
      const info = await page.evaluate(() => {
        return {
          title: document.title,
          videos: Array.from(document.querySelectorAll('video')).map(v => ({
            src: v.src, currentSrc: v.currentSrc, poster: v.poster,
            sources: Array.from(v.querySelectorAll('source')).map(s => ({ src: s.src, type: s.type })),
          })),
          iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src).slice(0, 5),
        };
      });
      console.log('  title:', t);
      console.log('  videos:', info.videos.length);
      info.videos.forEach((v, i) => console.log('   v#' + i, JSON.stringify(v).slice(0, 200)));
      console.log('  media:', media.length, 'xhr:', xhr.length);
      xhr.slice(0, 5).forEach(x => console.log('   X', x.url.slice(0, 200)));
      media.filter(m => m.url.includes('m3u8') || m.url.includes('.ts')).slice(0, 5).forEach(m => {
        console.log('   M', m.url.slice(0, 200), 'body:', m.body?.slice(0, 200));
      });
      if (info.videos.length > 0 || media.some(m => m.url.includes('m3u8'))) {
        fs.writeFileSync(path.join(OUT, 'yp_' + id + '_media.json'), JSON.stringify(media, null, 2));
        fs.writeFileSync(path.join(OUT, 'yp_' + id + '_xhr.json'), JSON.stringify(xhr, null, 2));
        fs.writeFileSync(path.join(OUT, 'yp_' + id + '_page.json'), JSON.stringify(info, null, 2));
        if (info.videos.length > 0) {
          console.log('  [FOUND VIDEO] /yp/' + id);
          break;
        }
      }
    } catch (e) { console.log('  err:', e.message); }
  }

  // 试 /yx/
  for (let id = 1; id <= 5; id++) {
    console.log('\n=== /yx/' + id);
    media.length = 0;
    try {
      await page.goto('https://www.quradpk.com:2087/yx/' + id, { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(5000);
      const t = await page.title();
      const info = await page.evaluate(() => ({
        title: document.title,
        videos: Array.from(document.querySelectorAll('video')).map(v => v.src || v.currentSrc),
      }));
      console.log('  title:', t, 'vids:', info.videos.length);
      info.videos.forEach(v => console.log('   v', v));
      if (info.videos.length > 0) break;
    } catch (e) { console.log('  err:', e.message); }
  }

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
