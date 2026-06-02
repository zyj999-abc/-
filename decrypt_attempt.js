// 第十九轮：尝试用 88 字节 key 解密 data
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v19';
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

  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);

  // 1. 调用 /v1/vod + 在浏览器里暴力试解密
  const out = await page.evaluate(async () => {
    const res = await fetch('/v1/vod?c=10&sort=new&page=1&limit=5');
    const j = await res.json();
    const dataB = Uint8Array.from(atob(j.data), c => c.charCodeAt(0));
    const keyB = Uint8Array.from(atob(j.key), c => c.charCodeAt(0));
    const out = { dataLen: dataB.length, keyLen: keyB.length };

    const tryDec = async (k, iv, body, algo = 'AES-CBC') => {
      try {
        const ck = await crypto.subtle.importKey('raw', k, { name: algo }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: algo, iv }, ck, body);
        return new TextDecoder().decode(pt);
      } catch (e) { return 'ERR:' + e.message; }
    };
    const tryGCM = async (k, iv, body) => {
      try {
        const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, body);
        return new TextDecoder().decode(pt);
      } catch (e) { return 'ERR:' + e.message; }
    };
    const tryECB = async (k, body) => {
      try {
        const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-ECB' }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-ECB' }, ck, body);
        return new TextDecoder().decode(pt);
      } catch (e) { return 'ERR:' + e.message; }
    };

    // 88 字节 key 分解
    const k32 = keyB.slice(0, 32);
    const k16 = keyB.slice(0, 16);
    const k24 = keyB.slice(0, 24);
    const k64 = keyB.slice(0, 64);

    // iv 候选
    const iv16 = keyB.slice(48, 64);
    const iv16v2 = keyB.slice(32, 48);
    const iv16v3 = keyB.slice(16, 32);

    // data 分解
    const dIv16 = dataB.slice(0, 16);
    const dIv12 = dataB.slice(0, 12);
    const dBody = dataB.slice(16);
    const dBody12 = dataB.slice(12);

    // 试 1: AES-256-CBC key=key前32, iv=data前16
    out.t1 = await tryDec(k32, dIv16, dBody);
    // 试 2: AES-128-CBC key=key前16, iv=data前16
    out.t2 = await tryDec(k16, dIv16, dBody);
    // 试 3: AES-192-CBC key=key前24, iv=data前16
    out.t3 = await tryDec(k24, dIv16, dBody);
    // 试 4: AES-256-CBC key=key前32, iv=key后16
    out.t4 = await tryDec(k32, iv16, dataB);
    // 试 5: AES-128-CBC key=key前16, iv=key后16
    out.t5 = await tryDec(k16, iv16, dataB);
    // 试 6: AES-128-CBC key=key[16:32], iv=key[32:48]
    out.t6 = await tryDec(keyB.slice(16, 32), iv16v2, dataB);
    // 试 7: AES-128-CBC key=key[32:48], iv=key[48:64]
    out.t7 = await tryDec(keyB.slice(32, 48), iv16, dataB);
    // 试 8: AES-256-CBC key=key, iv=0
    out.t8 = await tryDec(keyB, new Uint8Array(16), dataB);
    // 试 9: AES-256-GCM key=key前32, iv=data前12
    out.t9 = await tryGCM(k32, dIv12, dBody12);
    // 试 10: AES-128-ECB key=key前16
    out.t10 = await tryECB(k16, dataB);
    // 试 11: AES-256-ECB key=key前32
    out.t11 = await tryECB(k32, dataB);
    // 试 12: AES-128-CBC key=key[0:16], iv=data[0:16], body=data[16:]
    out.t12 = await tryDec(k16, dIv16, dBody);
    // 试 13: AES-256-GCM key=key[0:32], iv=key[16:28]
    out.t13 = await tryGCM(k32, keyB.slice(16, 28), dBody12);
    // 试 14: AES-256-GCM key=key[0:32], iv=key[16:32]（12字节不补 0 ）
    out.t14 = await tryGCM(k32, keyB.slice(16, 28), dataB);

    return out;
  });
  fs.writeFileSync(path.join(OUT, '1_decrypt_attempts.json'), JSON.stringify(out, null, 2));
  console.log('=== dataLen:', out.dataLen, 'keyLen:', out.keyLen);
  for (let i = 1; i <= 14; i++) {
    const k = 't' + i;
    const v = out[k] || '';
    const preview = String(v).slice(0, 200);
    console.log(' ' + k + ':', preview);
  }

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
