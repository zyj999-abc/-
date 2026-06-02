// 第三轮：访问真实视频/小说页面 + 抓所有动态 bundle
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_track3';
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

  // 抓所有 JS bundle（用 urlFilter）
  const captured = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('ghj7saa.xn--') && !u.includes('ajskbnrs.xn--') && !u.includes('quradpk.com')) return;
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('javascript') && !ct.includes('html') && !ct.includes('json')) return;
      const buf = await res.buffer();
      let safeUrl = u.replace(/[^a-z0-9.]/gi, '_').slice(0, 200);
      const fp = path.join(OUT, captured.length + '_' + safeUrl);
      fs.writeFileSync(fp, buf);
      captured.push({ url: u, file: fp, size: buf.length });
    } catch (e) {}
  });

  // ===== 访问 quradpk 首页 =====
  console.log('=== visit quradpk 首页 ===');
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // 抓页面所有 a 链接
  let allLinks = await page.$$eval('a[href]', els => els.map(a => a.href).filter(h => !h.startsWith('data:') && !h.startsWith('javascript:')));
  fs.writeFileSync(path.join(OUT, 'all_links.json'), JSON.stringify(allLinks, null, 2));
  console.log('[all links]', allLinks.length, 'items');
  console.log('  sample:', allLinks.slice(0, 15));

  // 找视频/小说/漫画/女优/番号入口
  let pageInfo = await page.evaluate(() => {
    return {
      title: document.title,
      bodyText: (document.body?.innerText || '').slice(0, 1500),
      // 抓所有"非遮罩"链接（去除 0.01 透明 div 下的）
      realLinks: Array.from(document.querySelectorAll('a[href]'))
        .filter(a => a.offsetParent !== null || a.getBoundingClientRect().width > 0)
        .map(a => ({ href: a.href, text: a.innerText?.slice(0, 50) || '' }))
        .filter(x => x.text)
        .slice(0, 30),
      // 找真实按钮（覆盖层后面的）
      realButtons: Array.from(document.querySelectorAll('button, [role=button]'))
        .filter(b => b.offsetParent !== null).map(b => b.innerText?.slice(0, 30)).filter(Boolean).slice(0, 10),
    };
  });
  fs.writeFileSync(path.join(OUT, 'page_info.json'), JSON.stringify(pageInfo, null, 2));
  console.log('[title]', pageInfo.title);
  console.log('[body text 200]', pageInfo.bodyText.slice(0, 200));
  console.log('[real links]', pageInfo.realLinks.length, 'items, sample:');
  pageInfo.realLinks.slice(0, 10).forEach(l => console.log('  ', l.text, '->', l.href));

  // 访问第一个有内容的链接（视频详情/小说列表/漫画列表）
  const targets = [
    '/v_category', '/v_cate', '/category', '/list',
    '/novel', '/novel-list', '/novel_rank', '/novel_category',
    '/comic', '/comic_list', '/actress',
    '/v_play/1', '/v_detail/1', '/play/1', '/detail/1',
  ];
  for (const t of targets) {
    try {
      await page.goto('https://www.quradpk.com:2087' + t, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await sleep(2500);
      const newTitle = await page.title();
      const newUrl = page.url();
      const newBodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 200));
      console.log(`\n[try ${t}] -> ${newUrl} title=${newTitle}`);
      console.log('  body:', newBodyText);
      if (newBodyText.length > 50 && !newBodyText.includes('404')) break;
    } catch (e) { console.log(`  ${t} err: ${e.message}`); }
  }

  // 抓最终页内容
  const final = await page.content();
  fs.writeFileSync(path.join(OUT, 'final.html'), final);

  // 抓所有 script + 找 en/decrypt
  const allScripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
  });
  console.log('\n[all script srcs]', allScripts.length);
  fs.writeFileSync(path.join(OUT, 'scripts.json'), JSON.stringify(allScripts, null, 2));

  await browser.close();
  console.log('\nDONE. Files:', captured.length);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
