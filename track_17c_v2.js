// 第二轮：抓 video-play 和解密算法 bundle
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_track2';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--ignore-certificate-errors', '--lang=zh-CN,zh', '--window-size=1280,800',
    ],
  });
  const ctx = await browser.createBrowserContext();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
  const page = await ctx.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  const captured = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('ghj7saa.xn--') || u.includes('ajskbnrs.xn--') || u.includes('dpic.xn--')) {
      try {
        const buf = await res.buffer();
        let safeUrl = u.replace(/[^a-z0-9.]/gi, '_').slice(0, 200);
        let ext = '';
        if (u.endsWith('.js')) ext = '.js';
        else if (u.endsWith('.css')) ext = '.css';
        else if (u.endsWith('.html')) ext = '.html';
        else if (u.endsWith('.txt')) ext = '.txt';
        else ext = '.bin';
        const fp = path.join(OUT, 'r' + captured.length + '_' + safeUrl + ext);
        fs.writeFileSync(fp, buf);
        captured.push({ url: u, file: fp, size: buf.length });
        console.log('  [SAVED] ' + u + ' (' + buf.length + 'B)');
      } catch (e) {}
    }
  });

  console.log('=== goto quradpk 首页 ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);

  console.log('=== 当前 URL:', page.url());

  // 触发 goto 真实视频详情（猜测路径：/v_play/数字）
  // 看页面里有没有视频链接
  const videoLinks = await page.$$eval('a[href*="play"],a[href*="video"],a[href*="/v"]', els => els.slice(0, 10).map(a => a.href));
  console.log('[videoLinks]', videoLinks);

  // 点一个
  if (videoLinks[0]) {
    console.log('=== click first video link:', videoLinks[0]);
    try {
      await page.goto(videoLinks[0], { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(5000);
      console.log('  now at:', page.url());
    } catch (e) { console.log('  err', e.message); }
  } else {
    // 直接试一些常见路径
    for (const path of ['/v_play/1', '/v_detail/1', '/play/1', '/video/1']) {
      try {
        console.log('=== try', path);
        await page.goto('https://www.quradpk.com:2087' + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(3000);
        console.log('  now at:', page.url(), ' title:', await page.title());
        if (page.url() !== 'https://www.quradpk.com:2087/') break;
      } catch (e) {}
    }
  }

  // 抓页面最终内容 + DOM 中的视频
  const finalHTML = await page.content();
  fs.writeFileSync(path.join(OUT, 'final.html'), finalHTML);
  console.log('final HTML saved, size:', finalHTML.length);

  // 在浏览器里执行 en() 验证 + 解密 blist
  const decryptResult = await page.evaluate(async () => {
    // 尝试找前端定义的解密函数
    let results = {};

    // 1. 抓 window 全局可能暴露的解密 key / 函数
    try {
      results.windowKeys = Object.keys(window).filter(k =>
        /decryp|decod|aes|sm4|secret|key|des|descr/i.test(k)
      ).slice(0, 20);
    } catch (e) { results.windowKeys = 'err'; }

    // 2. 抓所有 script 找 "key" 字段处理
    try {
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
      // 找 aes key/iv/sm4 字样
      const matches = [];
      const re = /(['"]?)([A-Za-z0-9+/=]{16,64})\1/g;
      let m;
      while ((m = re.exec(scripts)) !== null) {
        if (/aes|sm4|key|iv|secret/i.test(scripts.slice(Math.max(0, m.index - 50), m.index))) {
          matches.push(m[2]);
        }
      }
      results.keyMatches = matches.slice(0, 5);

      // 找 AES/SM4 调用
      const aesM = scripts.match(/(AES|SM4|aes|sm4)[\s\S]{0,200}/g);
      results.aesM = (aesM || []).slice(0, 3).map(s => s.slice(0, 200));
    } catch (e) { results.scriptErr = e.message; }

    // 3. 抓页面 DOM 中的视频
    try {
      results.videos = Array.from(document.querySelectorAll('video')).map(v => ({
        src: v.src,
        sources: Array.from(v.querySelectorAll('source')).map(s => s.src),
        poster: v.poster,
      }));
    } catch (e) {}

    // 4. 抓页面 DOM 中的关键文本
    try {
      const txt = (document.body?.innerText || '').slice(0, 1000);
      results.bodyText = txt;
    } catch (e) {}

    return results;
  });
  fs.writeFileSync(path.join(OUT, 'decrypt_scan.json'), JSON.stringify(decryptResult, null, 2));
  console.log('[decrypt scan keys]', decryptResult.windowKeys);
  console.log('[body text]', (decryptResult.bodyText || '').slice(0, 300));

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
