// 第六轮：访问真实小说/漫画/分类页，输出 base64
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_real';
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

  // 抓所有响应
  const responses = [];
  page.on('response', async (res) => {
    try {
      const u = res.url();
      if (u.startsWith('data:') || u.startsWith('blob:')) return;
      const ct = res.headers()['content-type'] || '';
      if (!/html|json|javascript/.test(ct)) return;
      const buf = await res.buffer();
      responses.push({ url: u, ct, status: res.status(), size: buf.length, body: buf.toString('utf-8').slice(0, 500000) });
    } catch (e) {}
  });

  const pages_to_visit = [
    { url: 'https://www.quradpk.com:2087/', name: 'home' },
    { url: 'https://www.quradpk.com:2087/novel/list', name: 'novel_list' },
    { url: 'https://www.quradpk.com:2087/novel/1', name: 'novel_1' },
    { url: 'https://www.quradpk.com:2087/comic/1', name: 'comic_1' },
    { url: 'https://www.quradpk.com:2087/category/1', name: 'category_1' },
    { url: 'https://www.quradpk.com:2087/category/2', name: 'category_2' },
    { url: 'https://www.quradpk.com:2087/category/3', name: 'category_3' },
  ];

  const visited = [];
  for (const tp of pages_to_visit) {
    log('=== visit:', tp.url);
    responses.length = 0;
    try {
      await page.goto(tp.url, { waitUntil: 'networkidle2', timeout: 20000 });
    } catch (e) { log('  err', e.message); }
    await sleep(5000);

    const info = await page.evaluate(() => {
      return {
        url: location.href,
        title: document.title,
        // 抓页面正文（不靠 innerText 因为有遮罩）
        bodyText: (document.body?.innerText || '').slice(0, 3000),
        // 抓所有 video 标签
        videos: Array.from(document.querySelectorAll('video')).map(v => ({
          src: v.src, currentSrc: v.currentSrc, poster: v.poster,
          sources: Array.from(v.querySelectorAll('source')).map(s => ({ src: s.src, type: s.type })),
        })),
        // 抓所有 img
        images: Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s && !s.startsWith('data:')).slice(0, 20),
        // 抓所有跳转链接
        links: Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => !h.startsWith('data:') && !h.startsWith('javascript:'))
          .filter((v, i, a) => a.indexOf(v) === i).slice(0, 50),
      };
    });
    fs.writeFileSync(path.join(OUT, tp.name + '_info.json'), JSON.stringify(info, null, 2));
    fs.writeFileSync(path.join(OUT, tp.name + '_final.html'), await page.content());
    fs.writeFileSync(path.join(OUT, tp.name + '_responses.json'), JSON.stringify(responses.map(r => ({ url: r.url, ct: r.ct, size: r.size, status: r.status, body: r.body?.slice(0, 200) })), null, 2));
    visited.push({ name: tp.name, info: { url: info.url, title: info.title, bodyLen: info.bodyText.length, videoCount: info.videos.length, imageCount: info.images.length, linkCount: info.links.length } });
    log('  title:', info.title);
    log('  bodyLen:', info.bodyText.length, 'videos:', info.videos.length, 'imgs:', info.images.length, 'links:', info.links.length);
    if (info.videos.length > 0) {
      log('  video[0]:', JSON.stringify(info.videos[0]).slice(0, 300));
    }
    info.images.slice(0, 5).forEach((img, i) => log('  img#' + i + ':', img));
  }

  fs.writeFileSync(path.join(OUT, '_visited.json'), JSON.stringify(visited, null, 2));
  await browser.close();
  log('=== DONE ===');
})().catch(e => { log('FATAL:', e.message); process.exit(1); });
