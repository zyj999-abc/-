const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1366,768'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  });

  // hook XHR
  await page.evaluateOnNewDocument(() => {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      if (this._url && this._url.includes('/api/check')) {
        console.log('[HOOK] /api/check body:', body ? body.substring(0, 1500) : 'null');
        window.__checkBody = body;
      }
      return origSend.apply(this, arguments);
    };
  });

  const respLog = [];
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (url.includes('/api/check') || url.includes('/api/verify')) {
        const txt = await resp.text();
        respLog.push({ url, body: txt.substring(0, 1000) });
      }
    } catch (e) {}
  });
  page.on('console', m => {
    if (m.text().includes('[HOOK]')) {
      console.log(m.text());
    }
  });

  await page.goto('https://passport.jd.com/uc/login', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(2000);

  async function humanInput(sel, text) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await sleep(100);
    await page.mouse.click(x, y, { clickCount: 3 });
    await sleep(100);
    for (const ch of text) {
      await page.keyboard.type(ch, { delay: 80 + Math.random() * 80 });
    }
  }
  async function humanClick(sel) {
    const el = await page.$(sel);
    const box = await el.boundingBox();
    const x = box.x + 10 + Math.random() * (box.width - 20);
    const y = box.y + 5 + Math.random() * (box.height - 10);
    await page.mouse.move(x, y, { steps: 5 });
    await sleep(150);
    await page.mouse.click(x, y);
  }

  const ts = Date.now().toString().slice(-8);
  await humanInput('#loginname', 'jdtest_' + ts + '@163.com');
  await sleep(500);
  await humanInput('#nloginpwd', 'Pwd!@#abc1234');
  await sleep(800);

  // 触发
  let triggered = false;
  for (let i = 1; i <= 4; i++) {
    await humanClick('.login-btn');
    for (let w = 0; w < 8; w++) {
      await sleep(2000);
      const r = await page.evaluate(() => !!document.querySelector('#cpc_img, #curve_main_img, #main_img'));
      if (r) {
        console.log('triggered click=' + i);
        triggered = true;
        break;
      }
    }
    if (triggered) break;
    await sleep(5000);
  }
  if (!triggered) { console.log('not triggered'); await browser.close(); return; }
  await sleep(2000);

  // 抓 cpc_img
  const imgInfo = await page.evaluate(() => {
    const cpc = document.querySelector('#cpc_img');
    if (!cpc || !cpc.src) return null;
    const r = cpc.getBoundingClientRect();
    return { src: cpc.src, w: cpc.naturalWidth, h: cpc.naturalHeight, x: r.x, y: r.y, dw: cpc.offsetWidth, dh: cpc.offsetHeight };
  });
  if (!imgInfo) { console.log('no img'); await browser.close(); return; }

  // 画简单对角线
  const x1 = imgInfo.x + 20;
  const y1 = imgInfo.y + 20;
  const x2 = imgInfo.x + imgInfo.dw - 20;
  const y2 = imgInfo.y + imgInfo.dh - 20;

  await page.mouse.move(x1, y1, { steps: 10 });
  await sleep(200);
  await page.mouse.down();
  await sleep(100);
  for (let i = 1; i <= 30; i++) {
    const t = i / 30;
    await page.mouse.move(x1 + t * (x2 - x1), y1 + t * (y2 - y1));
    await sleep(30);
  }
  await sleep(200);
  await page.mouse.up();
  console.log('mouseup done');
  await sleep(10000);

  // 输出 hook 到的 body
  const body = await page.evaluate(() => window.__checkBody);
  if (body) {
    console.log('=== /api/check body ===');
    console.log(body);
  }

  console.log('=== responses ===');
  for (const r of respLog.slice(0, 10)) {
    console.log(r.url);
    console.log(r.body);
  }

  await browser.close();
})();
