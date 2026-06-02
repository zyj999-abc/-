// 第二十二轮：用前端解密算法逆向数据
const puppeteer = require('puppeteer-core');
const sm = require('sm-crypto');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHROME = '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const OUT = '/tmp/17c_v22';
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

  // 1. 在浏览器里调用前端解密函数 jh({data, key})，拿明文
  const r = await page.evaluate(async () => {
    // 拿真实 API 数据
    const res = await fetch('/v1/vod?c=10&sort=new&page=1&limit=5');
    const j = await res.json();

    // 找 jh 函数 + jh 闭包
    // 它的闭包里有 SM2 公钥
    // 用 eval 跑 jh（从源码里提取）
    // 实际上 jh 是 module-scope function, 不在 window 上
    // 但 SM2 公钥是字符串字面量，存在某处

    // 找 SM2 公钥
    const allScripts = Array.from(document.scripts).map(s => s.src || s.textContent.slice(0, 100));
    let sm2Pub = null;

    // 直接 fetch main bundle 找
    const mainBundleUrl = window.__toCdnUrl('/assets/t1/static/index-legacy-CGDG5SHS.js');
    const mainBundle = await fetch(mainBundleUrl).then(r => r.text());

    // 找 SM2 公钥（Base64 DER 格式）
    const sm2Match = mainBundle.match(/MIIB[A-Za-z0-9+/=]{20,}/);
    sm2Pub = sm2Match ? sm2Match[0] : null;

    // 找 jh 函数定义
    // 之前看 jh 是 function jh({data:t,key:e}){...}
    // 但不在 window 上。我们手动实现
    // 或者用 eval 跑 jh

    // 提取 jh 完整定义
    const jhMatch = mainBundle.match(/function jh\([^)]+\)\{[\s\S]{0,2000}\}/);
    const jhSrc = jhMatch ? jhMatch[0] : null;

    // 提取依赖
    const deps = [];
    // jh 用了 Xu (SM2), Nh (CryptoJS), Qu, Ju
    // 这些 module 都在 main bundle 里

    // 直接 eval jh 看返回
    let jhResult = null;
    let jhErr = null;
    try {
      // 把 jh eval 进去
      // 但是 jh 引用了 Xu, Nh - 这些不在 window 上
      // 所以要构造上下文
    } catch (e) { jhErr = e.message; }

    return { data: j.data, key: j.key, sm2Pub, jhSrc, jhResult, jhErr };
  });
  fs.writeFileSync(path.join(OUT, '1_extract.json'), JSON.stringify(r, null, 2));
  console.log('=== sm2Pub len:', r.sm2Pub?.length);
  console.log('  sm2Pub (前 200):', r.sm2Pub?.slice(0, 200));
  console.log('=== jhSrc (前 500):', r.jhSrc?.slice(0, 500));
  console.log('=== data len:', r.data.length, 'key len:', r.key.length);

  // 2. 在浏览器里手动实现解密算法
  // 1) SM2.decrypt(key) -> AES key
  // 2) AES-CBC(key) base64 decode(data) iv=reverse(key)[:16]
  const decrypt = await page.evaluate(async (data, key, sm2Pub) => {
    const out = {};

    // 用 sm-crypto 库（如果页面已经引入了）
    // 或者用 Node.js 在外部跑

    // 试试页面是否暴露了 sm2 函数
    out.windowKeys = Object.keys(window).filter(k => /sm2|sm3|sm4|crypto|decrypt/i.test(k));

    // 1. SM2 decrypt key
    let aesKey = null, sm2Err = null;
    try {
      // sm-crypto 用法：sm.sm2.decrypt(encryptData, privateKey, {input, output})
      // 公钥不能 decrypt！需要私钥！
      // SM2 的公钥是加密用的，私钥是解密用的
      // 但代码里用的是 setPublicKey 然后 decrypt - 这是反过来的用法
      // 可能是交换了角色（client encrypts with public, server decrypts with private）
      // 但 jh 是 client 端代码，调用 decrypt - 应该用 私钥
      // 但代码里 setPublicKey - 错误？
      // 让我看 jh 完整代码

      // 实际上有些 sm-crypto 实现接受公钥做 "decrypt"（不规范但有些库这样做）
      // 我先试 sm-crypto with private key
    } catch (e) { sm2Err = e.message; }
    out.sm2Err = sm2Err;

    // 2. 假设 sm2 解出 AES key 已经是 16/32 字节字符串
    //    AES-CBC-128 用 key 16 字节
    //    IV = reverse(AES key).substring(0, 16)
    //    data base64 decode 后 AES-CBC-PKCS7 decrypt

    // 试：直接用 key 当 AES key (假设 key 已经是 AES key 而不是 SM2 密文)
    // 88 字节 base64 -> 64 字节 -> 不对 AES key 长度
    // 但 data 可能是 SM2 encrypted AES key, 64 字节 SM2 输出 -> AES 32 字节？

    // 看 SM2 输出格式：C1C3C2 (75 字节) 或 C1C2C3 (96 字节)
    // 64 字节 太小了

    // 试 C1C2C3 格式 (96 字节)
    // 试 C1C3C2 格式 (75 字节)

    // 试直接 base64 decode key 当 AES key
    // 64 字节 = 不是标准 AES key
    // 但可以从中取 16/32 字节

    // 试: 把 key 当字符串，反转后取前 16 字节当 IV, 用 key 前 16 当 AES key
    // 用 key 前 32 当 AES-256 key, iv = reverse(key).substring(0, 16)
    const keyStr = atob(key);
    const keyBytes = new Uint8Array(keyStr.length);
    for (let i = 0; i < keyStr.length; i++) keyBytes[i] = keyStr.charCodeAt(i);

    // reverse
    const rev = keyBytes.slice().reverse();
    const iv = rev.slice(0, 16);

    // 试不同 AES key 长度
    for (const kLen of [16, 32]) {
      const k = keyBytes.slice(0, kLen);
      try {
        const dataBytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-CBC' }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, dataBytes);
        const dec = new TextDecoder().decode(pt);
        out['aes' + kLen + '_keyFirst_rev_iv'] = dec.slice(0, 500);
      } catch (e) {
        out['aes' + kLen + '_keyFirst_rev_iv_err'] = e.message;
      }
    }

    // 试 key = base64 of key 字符串 (utf8) - 即 key 当字符串是 AES key
    const keyAsStr = new Uint8Array(keyStr.length);
    for (let i = 0; i < keyStr.length; i++) keyAsStr[i] = keyStr.charCodeAt(i);
    // 取前 16/32 当 AES key
    for (const kLen of [16, 32]) {
      const k = keyAsStr.slice(0, kLen);
      const iv2 = new Uint8Array(16);
      try {
        const dataBytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-CBC' }, false, ['decrypt']);
        const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv2 }, ck, dataBytes);
        const dec = new TextDecoder().decode(pt);
        out['aes' + kLen + '_zero_iv'] = dec.slice(0, 500);
      } catch (e) {
        out['aes' + kLen + '_zero_iv_err'] = e.message;
      }
    }

    return out;
  }, r.data, r.key, r.sm2Pub);
  fs.writeFileSync(path.join(OUT, '2_decrypt.json'), JSON.stringify(decrypt, null, 2));
  console.log('=== windowKeys:', decrypt.windowKeys);
  for (const k of Object.keys(decrypt)) {
    if (k.startsWith('aes')) {
      const v = String(decrypt[k]).slice(0, 300);
      console.log(' ' + k + ':', v);
    }
  }

  // 3. 在浏览器里调用 jh 函数（用 eval 注入到 window）
  const jhResult = await page.evaluate(async (sm2Pub) => {
    // 把 jh 函数注入 window
    // 先看 jh 完整代码
    const mainUrl = window.__toCdnUrl('/assets/t1/static/index-legacy-CGDG5SHS.js');
    const main = await fetch(mainUrl).then(r => r.text());

    // 找 jh 完整代码（包括 Xu, Nh 引用）
    const jhStart = main.indexOf('function jh(');
    if (jhStart < 0) return { err: 'no jh found' };

    // 找 jh 闭包结束（找匹配的 }）
    let depth = 0;
    let jhEnd = jhStart;
    for (let i = jhStart; i < main.length; i++) {
      if (main[i] === '{') depth++;
      else if (main[i] === '}') {
        depth--;
        if (depth === 0) { jhEnd = i + 1; break; }
      }
    }
    const jhCode = main.slice(jhStart, jhEnd);
    return { jhCode, jhStart, jhEnd, len: jhEnd - jhStart };
  });
  fs.writeFileSync(path.join(OUT, '3_jh_code.txt'), jhResult.jhCode || '');
  console.log('=== jhCode len:', jhResult.len);
  console.log('  jhCode (前 500):', jhResult.jhCode?.slice(0, 500));

  await browser.close();
  console.log('=== DONE ===');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
