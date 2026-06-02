// 第二十一轮：hook crypto.subtle.decrypt 抓前端实际解密参数
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v21';
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
    window.__SUBTLE__ = [];
    // 抓 importKey 调用
    const origImport = crypto.subtle.importKey;
    crypto.subtle.importKey = function(format, keyData, algo, exp, usages) {
      window.__SUBTLE__.push({
        t: Date.now(),
        fn: 'importKey',
        format,
        algo: String(algo),
        keyDataLen: keyData?.byteLength || 0,
        usages: Array.from(usages || []),
        // 抓前 64 字节 key data
        keyPreview: keyData ? Buffer.from(new Uint8Array(keyData).slice(0, 32)).toString('hex') : '',
      });
      return origImport.apply(this, arguments);
    };
    // 抓 decrypt 调用
    const origDec = crypto.subtle.decrypt;
    crypto.subtle.decrypt = function(algo, key, data) {
      const iv = algo.iv ? Buffer.from(new Uint8Array(algo.iv)).toString('hex') : '';
      window.__SUBTLE__.push({
        t: Date.now(),
        fn: 'decrypt',
        algoName: algo.name,
        iv,
        dataLen: data?.byteLength || 0,
        dataPreview: data ? Buffer.from(new Uint8Array(data).slice(0, 32)).toString('hex') : '',
      });
      return origDec.apply(this, arguments);
    };
  });

  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(10000);

  const hooks = await page.evaluate(() => window.__SUBTLE__);
  fs.writeFileSync(path.join(OUT, '1_subtle_hooks.json'), JSON.stringify(hooks, null, 2));
  console.log('=== subtle hooks:', hooks.length);
  hooks.forEach((h, i) => {
    if (h.fn === 'importKey') {
      console.log(' #' + i, 'importKey', h.algo, 'keyLen=' + h.keyDataLen, 'keyHex=' + h.keyPreview, 'usages=', h.usages.join(','));
    } else {
      console.log(' #' + i, 'decrypt', h.algoName, 'iv=' + h.iv, 'dataLen=' + h.dataLen, 'dataHex=' + h.dataPreview);
    }
  });

  // 抓 hooks 之后，再触发一些 XHR 看解密
  console.log('\n=== visit /yp/1 to trigger decrypt ===');
  hooks.length = 0;
  await page.goto('https://www.quradpk.com:2087/yp/1', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(10000);
  const h2 = await page.evaluate(() => window.__SUBTLE__);
  console.log('=== yp/1 hooks:', h2.length);
  h2.forEach((h, i) => {
    if (h.fn === 'importKey') {
      console.log(' #' + i, 'importKey', h.algo, 'keyLen=' + h.keyDataLen, 'keyHex=' + h.keyPreview, 'usages=', h.usages.join(','));
    } else {
      console.log(' #' + i, 'decrypt', h.algoName, 'iv=' + h.iv, 'dataLen=' + h.dataLen, 'dataHex=' + h.dataPreview);
    }
  });
  fs.writeFileSync(path.join(OUT, '2_yp_subtle.json'), JSON.stringify(h2, null, 2));

  // 再 visit novel/1
  console.log('\n=== visit /novel/1 to trigger decrypt ===');
  hooks.length = 0;
  await page.goto('https://www.quradpk.com:2087/novel/1', { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(10000);
  const h3 = await page.evaluate(() => window.__SUBTLE__);
  console.log('=== novel/1 hooks:', h3.length);
  h3.forEach((h, i) => {
    if (h.fn === 'importKey') {
      console.log(' #' + i, 'importKey', h.algo, 'keyLen=' + h.keyDataLen, 'keyHex=' + h.keyPreview, 'usages=', h.usages.join(','));
    } else {
      console.log(' #' + i, 'decrypt', h.algoName, 'iv=' + h.iv, 'dataLen=' + h.dataLen, 'dataHex=' + h.dataPreview);
    }
  });
  fs.writeFileSync(path.join(OUT, '3_novel_subtle.json'), JSON.stringify(h3, null, 2));

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
