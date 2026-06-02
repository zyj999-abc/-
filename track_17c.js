// 17c.com 完整跳转链跟踪
// 关键：记录每次跳转、每个 XHR、每段 JS 执行

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_track';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      '--lang=zh-CN,zh',
      '--window-size=1280,800',
    ],
  });

  const ctx = await browser.createBrowserContext();

  // ===== 拦截请求 =====
  const allRequests = [];
  const allResponses = [];
  const navigations = [];

  // ===== 真实 UA =====
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

  const page = await ctx.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // 抓主框架导航
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigations.push({ t: Date.now(), url: frame.url() });
      console.log(`[NAV] ${frame.url()}`);
    }
  });

  // 抓所有请求
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    allRequests.push({
      t: Date.now(),
      method: req.method(),
      url: u,
      type: req.resourceType(),
      postData: req.postData()?.slice(0, 200),
    });
  });

  // 抓所有响应
  page.on('response', async (res) => {
    const u = res.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    let body = null, bodyStr = null;
    try {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('html') || ct.includes('json') || ct.includes('javascript') || ct.includes('xml') || ct.includes('text')) {
        body = await res.buffer();
        bodyStr = body.toString('utf-8');
        if (bodyStr.length > 500000) bodyStr = bodyStr.slice(0, 500000) + '\n...[truncated]';
      }
    } catch (e) { bodyStr = '[body err: ' + e.message + ']'; }
    allResponses.push({
      t: Date.now(),
      status: res.status(),
      url: u,
      type: res.request().resourceType(),
      ct: res.headers()['content-type'] || '',
      body: bodyStr,
    });
  });

  page.on('console', (msg) => {
    console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    console.log(`[PAGEERR] ${err.message}`);
  });

  // ===== 第一步：访问 www.17c.com =====
  console.log('=== STEP 1: 访问 https://www.17c.com/ ===');
  try {
    await page.goto('https://www.17c.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log('goto err: ' + e.message);
  }
  await sleep(5000); // 等 JS 跳转完成

  // ===== 抓 L1 页面快照 =====
  let url1 = page.url();
  console.log(`[END OF STEP1] current URL: ${url1}`);
  let html1 = await page.content();
  fs.writeFileSync(path.join(OUT, '01_L1_' + url1.replace(/[^a-z0-9]/gi, '_') + '.html'), html1);
  fs.writeFileSync(path.join(OUT, '01_L1.html'), html1);

  // 抓所有 script
  const scripts1 = await page.$$eval('script[src]', els => els.map(e => e.src));
  fs.writeFileSync(path.join(OUT, '01_scripts.json'), JSON.stringify(scripts1, null, 2));

  // ===== 第二步：找候选 URL 并访问 =====
  // L1 页面可能含 guwvdfy.com 或 zgvjeuu.com
  let candidateUrls = await page.evaluate(() => {
    const out = [];
    // 收集所有候选 URL
    document.querySelectorAll('script').forEach(s => {
      if (s.src && s.src.includes('guwvdfy')) out.push(s.src);
    });
    // 抓 window.location
    return { scripts: out, location: location.href, referrer: document.referrer };
  });
  console.log('[L1 candidate scripts]', JSON.stringify(candidateUrls));

  // 提取页面所有域名
  let allDomains = await page.evaluate(() => {
    const out = new Set();
    const re = /([a-z0-9-]+\.(?:17c\.com|17ctz\.com|guwvdfy\.com|zgvjeuu\.com|a17k\.com|xn--[a-z0-9]+\.com|[a-z0-9-]{4,40}\.com)(?::\d+)?(?:\/[^\s"'<>]*)?)/gi;
    const txt = document.documentElement.outerHTML;
    let m;
    while ((m = re.exec(txt)) !== null) out.add(m[1]);
    return Array.from(out);
  });
  fs.writeFileSync(path.join(OUT, '01_domains.json'), JSON.stringify(allDomains, null, 2));
  console.log('[L1 domains]', allDomains);

  // 抓 setTimeout / setInterval 触发器
  let hooks = await page.evaluate(() => {
    // 列举可疑的跳转相关函数
    return {
      title: document.title,
      links: Array.from(document.querySelectorAll('a[href]')).map(a => a.href).slice(0, 30),
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src).slice(0, 10),
    };
  });
  fs.writeFileSync(path.join(OUT, '01_hooks.json'), JSON.stringify(hooks, null, 2));

  // ===== 第三步：访问候选 URL guwvdfy.com =====
  for (const c of ['https://www.guwvdfy.com:2087/', 'https://www.zgvjeuu.com:2087/']) {
    console.log(`\n=== STEP 3: 访问候选 ${c} ===`);
    try {
      // 先重置计数器（部分清零）
      navigations.length = 0;
      await page.goto(c, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log('  goto err: ' + e.message);
    }
    await sleep(8000); // 等 JS 跳转 / meta refresh / setTimeout 全部触发

    let finalUrl = page.url();
    console.log(`  final URL: ${finalUrl}`);

    let html2 = await page.content();
    fs.writeFileSync(path.join(OUT, '02_cand_' + new URL(c).hostname + '.html'), html2);

    // 抓 navigation 历史
    console.log('  navigations:');
    navigations.forEach(n => console.log(`    ${new Date(n.t).toISOString()} ${n.url}`));

    // 抓所有跳转候选
    let nextCands = await page.evaluate(() => {
      return {
        title: document.title,
        location: location.href,
        links: Array.from(document.querySelectorAll('a[href]')).map(a => a.href).slice(0, 20),
        iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src).slice(0, 10),
        bodyText: (document.body?.innerText || '').slice(0, 500),
      };
    });
    console.log('  page meta:', JSON.stringify(nextCands, null, 2).slice(0, 1500));

    // 找页面中 en() 调用并跑一遍
    let execResult = await page.evaluate((c) => {
      // 抓所有 script 标签内容
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
      // 抓页面里出现的疑似密文
      const guesses = [];
      const re = /en\(\s*["']([^"']{10,200})["']\s*\)/g;
      let m;
      while ((m = re.exec(scripts)) !== null) {
        guesses.push(m[1]);
      }
      return { guesses, scriptsLen: scripts.length };
    }, c);
    console.log('  exec result:', JSON.stringify(execResult));

    if (execResult.guesses.length > 0) {
      // 在页面里执行 en
      let decoded = await page.evaluate((guesses) => {
        // 复制 dk 字典
        const dk = { "e":"P","w":"D","T":"y","+":"J","l":"!","t":"L","E":"E","@":"2","d":"a","b":"%","q":"l","X":"v","~":"R","5":"r","&":"X","C":"j","]":"F","a":")","^":"m",",":"~","}":"1","x":"C","c":"(","G":"@","h":"h",".":"*","L":"s","=":",","p":"g","I":"Q","1":"7","_":"u","K":"6","F":"t","2":"n","8":"=","k":"G","Z":"]",")":"b","P":"}","B":"U","S":"k","6":"i","g":":","N":"N","i":"S","%":"+","-":"Y","?":"|","4":"z","*":"-","3":"^","[":"{","(":"c","u":"B","y":"M","U":"Z","H":"[","z":"K","9":"H","7":"f","R":"x","v":"&","!":";","M":"_","Q":"9","Y":"e","o":"4","r":"A","m":".","O":"o","V":"W","J":"p","f":"d",":":"q","{":"8","W":"I","j":"?","n":"5","s":"3","|":"T","A":"V","D":"w",";":"O" };
        const en = (s) => {
          let out = '';
          for (const c of s) out += dk[c] !== undefined ? dk[c] : c;
          return out;
        };
        // 反向映射
        const rdk = {};
        for (const k in dk) rdk[dk[k]] = k;
        const de = (s) => {
          let out = '';
          for (const c of s) out += rdk[c] !== undefined ? rdk[c] : c;
          return out;
        };
        return guesses.map(g => ({ cipher: g, en: en(g), de: de(g) }));
      }, execResult.guesses);
      console.log('  decoded (in browser):', JSON.stringify(decoded, null, 2));
      fs.writeFileSync(path.join(OUT, '02_decoded_' + new URL(c).hostname + '.json'), JSON.stringify(decoded, null, 2));
    }

    // 触发再等 5 秒（防止二次跳转）
    await sleep(5000);
    let finalUrl2 = page.url();
    if (finalUrl2 !== finalUrl) {
      console.log(`  [SECOND JUMP] ${finalUrl} -> ${finalUrl2}`);
      let html3 = await page.content();
      fs.writeFileSync(path.join(OUT, '03_final_' + new URL(finalUrl2).hostname + '.html'), html3);
    }
  }

  // ===== 保存原始追踪 =====
  fs.writeFileSync(path.join(OUT, '_navigations.json'), JSON.stringify(navigations, null, 2));
  fs.writeFileSync(path.join(OUT, '_requests.json'), JSON.stringify(allRequests, null, 2));
  fs.writeFileSync(path.join(OUT, '_responses.json'), JSON.stringify(allResponses.map(r => ({
    t: r.t, status: r.status, url: r.url, type: r.type, ct: r.ct, bodyLen: (r.body||'').length
  })), null, 2));

  // 保存所有 body 文件
  allResponses.forEach((r, i) => {
    if (!r.body || r.body.length < 50) return;
    let safeUrl = r.url.replace(/[^a-z0-9.]/gi, '_').slice(0, 200);
    let ext = '';
    if (r.ct.includes('html')) ext = '.html';
    else if (r.ct.includes('javascript')) ext = '.js';
    else if (r.ct.includes('json')) ext = '.json';
    fs.writeFileSync(path.join(OUT, 'resp_' + i + '_' + safeUrl + ext), r.body);
  });

  console.log(`\n=== DONE. Files saved to ${OUT} ===`);
  await browser.close();
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
