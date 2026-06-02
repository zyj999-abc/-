// 第二十六轮：完整解密流程
const JSEncrypt = require('jsencrypt');
const cryptoJS = require('crypto-js');
const fs = require('fs');

(async () => {
  const data1 = JSON.parse(fs.readFileSync('/tmp/17c_v18/3_vod_raw.json', 'utf-8'));
  const cipher = data1.body.data;
  const rsaEnc = data1.body.key;
  const code = fs.readFileSync('/workspace/legacy.js', 'utf-8');
  const pub = code.match(/MIIB[A-Za-z0-9+/=]{50,}/)[0];

  // 1. RSA decrypt 出 AES key
  const crypt = new JSEncrypt();
  crypt.setPublicKey(pub);
  const aesKey = crypt.decrypt(rsaEnc);
  console.log('=== AES key:', aesKey);

  // 2. IV = reverse(AES key).substring(0, 16)
  const nArr = aesKey.split('');
  nArr.reverse();
  const iv = nArr.join('').substring(0, 16);
  console.log('=== IV:', iv);

  // 3. AES-CBC-PKCS7 decrypt
  const dec = cryptoJS.AES.decrypt(cipher, cryptoJS.enc.Utf8.parse(aesKey), {
    iv: cryptoJS.enc.Utf8.parse(iv),
    padding: cryptoJS.pad.Pkcs7,
  });
  const plain = cryptoJS.enc.Utf8.stringify(dec);
  console.log('=== 解密结果前 2000 字符 ===');
  console.log(plain.slice(0, 2000));

  // 4. 把所有抓到的 API 数据都解密
  console.log('\n=== 解密所有缓存的 API 数据 ===');
  for (const f of ['/tmp/17c_v18/3_vod_raw.json', '/tmp/17c_v18/4_yp_raw.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
      const c = j.body.data;
      const k = j.body.key;
      const aesK = crypt.decrypt(k);
      const nArr2 = aesK.split('');
      nArr2.reverse();
      const iv2 = nArr2.join('').substring(0, 16);
      const dec2 = cryptoJS.AES.decrypt(c, cryptoJS.enc.Utf8.parse(aesK), {
        iv: cryptoJS.enc.Utf8.parse(iv2),
        padding: cryptoJS.pad.Pkcs7,
      });
      const plain2 = cryptoJS.enc.Utf8.stringify(dec2);
      console.log('\n[' + f + '] decrypted:');
      console.log(plain2.slice(0, 1500));
    } catch (e) {
      console.log('[' + f + '] err:', e.message);
    }
  }

  // 5. 重新拿一批 API 数据
  console.log('\n=== 重新拿 5 个 API 解密 ===');
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--ignore-certificate-errors', '--lang=zh-CN,zh', '--window-size=1280,800'],
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto('https://www.quradpk.com:2087/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  const apis = await page.evaluate(async () => {
    const out = {};
    const fetchers = [
      ['blist', '/v1/blist?c=10'],
      ['popup', '/v1/popup?c=10'],
      ['tags', '/v1/tags?c=10&v=2'],
      ['relist', '/v1/relist?c=10'],
      ['vod_category', '/v1/vod/category?c=10'],
      ['yp', '/v1/yp?c=10&t=zy&at=0&page=1&limit=10'],
      ['yp2', '/v1/yp?c=10&t=rb&at=0&page=1&limit=5'],
      ['novel', '/v1/novel?c=10&sort=4&limit=5'],
      ['comic', '/v1/comic?c=10&limit=5'],
    ];
    for (const [name, url] of fetchers) {
      try {
        const r = await fetch(url);
        out[name] = await r.json();
      } catch (e) { out[name] = { err: e.message }; }
    }
    return out;
  });

  fs.writeFileSync('/tmp/all_apis_raw.json', JSON.stringify(apis, null, 2));
  console.log('  got ' + Object.keys(apis).length + ' APIs');

  for (const name of Object.keys(apis)) {
    const item = apis[name];
    if (!item || !item.data || !item.key) {
      console.log('  [' + name + '] no data/key');
      continue;
    }
    try {
      const aesK = crypt.decrypt(item.key);
      if (!aesK) { console.log('  [' + name + '] RSA failed'); continue; }
      const nArr3 = aesK.split('');
      nArr3.reverse();
      const iv3 = nArr3.join('').substring(0, 16);
      const dec3 = cryptoJS.AES.decrypt(item.data, cryptoJS.enc.Utf8.parse(aesK), {
        iv: cryptoJS.enc.Utf8.parse(iv3),
        padding: cryptoJS.pad.Pkcs7,
      });
      const plain3 = cryptoJS.enc.Utf8.stringify(dec3);
      console.log('\n[' + name + '] decrypted:');
      console.log(plain3.slice(0, 1000));
      fs.writeFileSync('/tmp/dec_' + name + '.json', plain3);
    } catch (e) {
      console.log('  [' + name + '] err:', e.message);
    }
  }

  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
