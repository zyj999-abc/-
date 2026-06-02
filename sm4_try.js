// 第二十轮：使用 sm-crypto 尝试 SM4 解密
const sm = require('sm-crypto');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v20';
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

  // 拿数据 + 在 Node 里解密
  const data = await page.evaluate(async () => {
    const r = await fetch('/v1/vod?c=10&sort=new&page=1&limit=5');
    const j = await r.json();
    return { data: j.data, key: j.key };
  });

  // 把数据传回 node
  console.log('data:', data.data.length, 'key:', data.key.length);

  // 各种解密尝试
  const keyBuf = Buffer.from(data.key, 'base64');
  const dataBuf = Buffer.from(data.data, 'base64');
  console.log('keyBuf len:', keyBuf.length, 'dataBuf len:', dataBuf.length);

  const tries = [];
  // 试 SM4-CBC, key 各种位置, iv 各种位置
  const positions = [
    [0, 16, 16, 16],   // key[0:16], iv[16:32], body[32:]
    [0, 16, 32, 16],   // key[0:16], iv[32:48], body[48:]
    [0, 16, 48, 16],   // key[0:16], iv[48:64], body[16:]
    [16, 16, 0, 16],   // key[16:32], iv[0:16], body[16:]
    [16, 16, 32, 16],  // key[16:32], iv[32:48], body[48:]
    [32, 16, 48, 16],  // key[32:48], iv[48:64], body[16:]
    [32, 16, 0, 16],   // key[32:48], iv[0:16], body[16:]
    [48, 16, 0, 16],   // key[48:64], iv[0:16], body[16:]
  ];
  for (const [kS, kL, iS, iL] of positions) {
    const k = keyBuf.slice(kS, kS+kL).toString('hex');
    const iv = keyBuf.slice(iS, iS+iL).toString('hex');
    const body = dataBuf.slice(16).toString('hex'); // data skip 16
    try {
      const dec = sm.sm4.decrypt(body, k);
      const first = dec.slice(0, 100);
      if (/^[\x20-\x7E\u4e00-\u9fa5]/.test(first)) {
        console.log('  [FOUND] kS=' + kS + ' iS=' + iS + ' body=skip16: ' + first);
        tries.push({ kS, iS, mode: 'data_skip16', dec: first });
      }
    } catch (e) {}

    // 试 data 全当密文
    const bodyAll = dataBuf.toString('hex');
    try {
      const dec = sm.sm4.decrypt(bodyAll, k);
      const first = dec.slice(0, 100);
      if (/^[\x20-\x7E\u4e00-\u9fa5]/.test(first)) {
        console.log('  [FOUND] kS=' + kS + ' iS=' + iS + ' body=all: ' + first);
        tries.push({ kS, iS, mode: 'data_all', dec: first });
      }
    } catch (e) {}
  }

  // 试 data 当 key 的一部分
  for (const [kS, kL] of [[0, 16], [16, 16], [32, 16], [48, 16]]) {
    const k = dataBuf.slice(kS, kS+kL).toString('hex');
    const iv = new Uint8Array(16);
    // data 当密文
    try {
      const dec = sm.sm4.decrypt(dataBuf.slice(16).toString('hex'), k);
      const first = dec.slice(0, 100);
      if (/^[\x20-\x7E\u4e00-\u9fa5]/.test(first)) {
        console.log('  [FOUND-DATAKEY] kS=' + kS + ': ' + first);
        tries.push({ mode: 'data_key', kS, dec: first });
      }
    } catch (e) {}
  }

  // 试 SM4-ECB
  for (const [kS, kL] of [[0, 16], [16, 16], [32, 16], [48, 16]]) {
    const k = keyBuf.slice(kS, kS+kL).toString('hex');
    try {
      const dec = sm.sm4.decrypt(dataBuf.toString('hex'), k);
      const first = dec.slice(0, 100);
      if (/^[\x20-\u9fa5]/.test(first)) {
        console.log('  [FOUND-ECB] kS=' + kS + ': ' + first);
        tries.push({ mode: 'sm4_ecb', kS, dec: first });
      }
    } catch (e) {}
  }

  // 试 SM3 hash
  for (const k of [keyBuf, dataBuf]) {
    const h = sm.sm3(k.toString('hex'));
    console.log('  sm3 hash:', h);
  }

  fs.writeFileSync(path.join(OUT, '1_sm4_attempts.json'), JSON.stringify(tries, null, 2));
  console.log('total sm4 tries success:', tries.length);

  // 2. 试 SM4 加上 key 字符串拼接
  console.log('\n=== try key as hex string ===');
  // 看 64 字节 key 是否含 SM2 公钥
  // SM2 公钥 64 字节 (x+y 各 32 字节)

  // 试 SM2 decrypt
  for (const kS of [0, 16, 32]) {
    for (const kL of [32, 64]) {
      if (kS + kL > 64) continue;
      const priv = keyBuf.slice(kS, kS+kL).toString('hex');
      try {
        const dec = sm.sm2.decrypt(dataBuf.toString('hex'), priv);
        const first = dec.slice(0, 100);
        if (first.length > 0) {
          console.log('  [SM2] kS=' + kS + ' kL=' + kL + ': ' + first);
        }
      } catch (e) {}
    }
  }

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
