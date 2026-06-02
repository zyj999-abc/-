// 第二十三轮：Node.js 端完整 jh 解密（用 sm-crypto + CryptoJS）
const sm = require('sm-crypto');
const cryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');

const OUT = '/tmp/17c_v23';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  // 1. 从 legacy.js 提取 jh 完整代码 + SM2 公钥
  const code = fs.readFileSync('/tmp/legacy.js', 'utf-8');

  // 找 SM2 公钥
  const sm2PubMatch = code.match(/MIIB[A-Za-z0-9+/=]{50,}/);
  const sm2Pub = sm2PubMatch?.[0];
  console.log('=== SM2 公钥:');
  console.log(' ', sm2Pub);
  console.log('  len:', sm2Pub?.length);

  // 找 jh 完整代码
  const jhStart = code.indexOf('function jh(');
  console.log('=== jh at', jhStart);

  // 找 jh 闭包（深度匹配）
  let depth = 0, jhEnd = jhStart;
  for (let i = jhStart; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { jhEnd = i + 1; break; } }
  }
  const jhCode = code.slice(jhStart, jhEnd);
  fs.writeFileSync(path.join(OUT, 'jh_code.txt'), jhCode);
  console.log('=== jh 代码长度:', jhCode.length);
  console.log('  jhCode (前 1000):');
  console.log(jhCode.slice(0, 1000));
  console.log('  jhCode (后 1000):');
  console.log(jhCode.slice(-1000));

  // 2. 测试数据 - 用之前抓到的 /v1/vod 数据
  // 真实数据从本地文件加载
  const data1 = JSON.parse(fs.readFileSync('/tmp/17c_v18/3_vod_raw.json', 'utf-8'));
  const cipher = data1.body.data;
  const sm2Enc = data1.body.key;
  console.log('\n=== 解密 /v1/vod 数据');
  console.log('  cipher len:', cipher.length, 'sm2Enc len:', sm2Enc.length);

  // 3. 解析 SM2 公钥
  let pubKeyObj = null;
  try {
    pubKeyObj = sm.sm2.publicKeyFromPem('-----BEGIN PUBLIC KEY-----\n' + sm2Pub + '\n-----END PUBLIC KEY-----');
    console.log('  SM2 pub parsed ok');
  } catch (e) {
    console.log('  SM2 pub parse err:', e.message);
  }

  // 4. SM2 decrypt key
  // sm-crypto: sm2.decrypt(encryptData, privateKey) - 需要私钥
  // 但代码用 setPublicKey + decrypt - 反常
  // 让我看 sm-crypto 实现

  // 公钥不能 decrypt - 这是 SM2 设计
  // 可能是代码搞反了
  // 让我用公钥反推私钥（不现实，SM2 是椭圆曲线不可逆）

  // 但 jh 用 setPublicKey + decrypt - 可能 sm-crypto 库的 bug 或特殊实现
  // 让我试 setPublicKey + decrypt 看输出
  try {
    const sm2cipher = Buffer.from(sm2Enc, 'base64').toString('hex');
    console.log('  sm2 cipher hex len:', sm2cipher.length);
    // sm2.crypt output mode C1C2C3 = 97+32=129 字节
    // 这里 64 字节 太小
    // 64 字节 看起来是 raw SM2 (C1+C3+C2 = 32+32+? = 64+?)
    // 64 字节 = 32(C1) + 32(C3) ？

    // sm-crypto 的 sm2.decrypt 用法
    // const decryptValue = sm.sm2.decrypt(encryptData, privateKey);
    // 但我们只有公钥

    // 看 jh 调用：setPublicKey 然后 e.decrypt(t)
    // 可能 sm-crypto 的 SM2 实现允许公钥做 decrypt（不规范但有些实现）
    // 让我用 sm2 库的伪实现试

    // 实际上：这里 setPublicKey + decrypt 的模式 — 可能代码搞反了但前端能跑通
    // 说明 server 是用私钥加密了 key，前端用公钥解密
    // 这是非标准 SM2 加密 - 但 jh 函数确实在跑

    // 试试：假设 decrypt 的输出是 AES key 字符串
    // 输出可能是 hex/base64 字符串

    // 用 raw sm-crypto API
    const cipherBytes = Buffer.from(sm2Enc, 'base64');
    console.log('  cipherBytes len:', cipherBytes.length);

    // 看 sm-crypto 是否能 publicKeyDecrypt
    // sm-crypto 0.x: sm2.decrypt(cipher, privateKey) - 私钥
    // 没有 publicKeyDecrypt

    // 但 jh 跑通了！说明前端用了 sm-crypto 的某 trick
    // 可能 server 端用了 publicKeyEncrypt (公钥加密，私钥解密)
    // 但 jh 用 setPublicKey + decrypt - 错误使用

    // 实际上看 jh 函数：它输出 n，然后用 n 当 AES key
    // 让我试 n 是不是 = key 本身（不解密）
    console.log('  假设 n = key 本身');
    const n = sm2Enc;  // 直接用
    // AES 解密
    const nStr = n;
    const nArr = nStr.split('');
    nArr.reverse();
    const ivStr = nArr.join('').substring(0, 16);
    console.log('  ivStr:', ivStr);
    // AES decrypt
    const cipherWA = cryptoJS.enc.Base64.parse(cipher);
    const keyWA = cryptoJS.enc.Utf8.parse(nStr);
    const ivWA = cryptoJS.enc.Utf8.parse(ivStr);
    try {
      const dec = cryptoJS.AES.decrypt({ ciphertext: cipherWA }, keyWA, { iv: ivWA, padding: cryptoJS.pad.Pkcs7 });
      const plain = cryptoJS.enc.Utf8.stringify(dec);
      console.log('  [DECRYPTED with n=key] 前 500:');
      console.log(plain.slice(0, 500));
    } catch (e) { console.log('  err:', e.message); }
  } catch (e) {
    console.log('  SM2 err:', e.message);
  }

  // 5. 试不同的 iv/key 组合
  console.log('\n=== 5. 暴力尝试 AES-CBC 解密 ===');
  const ciphB = Buffer.from(cipher, 'base64');
  // SM2 公钥 PEM
  const sm2PubHex = sm.sm2 ? null : null; // skip
  // 实际上 sm-crypto 的 sm2 库使用 X.509 DER，需要先解析

  // 试公钥
  let parsedKey = null;
  try {
    // sm.sm2.getPublicKeyFromHex 或 publicKeyFromPem
    parsedKey = sm.sm2.publicKeyFromPem('-----BEGIN PUBLIC KEY-----\n' + sm2Pub + '\n-----END PUBLIC KEY-----');
  } catch (e) {
    console.log('  parse err:', e.message);
  }

  // 用公钥直接调用 decrypt（不规范的 sm2 用法）
  if (parsedKey) {
    try {
      const dec = sm.sm2.doDecrypt ? sm.sm2.doDecrypt(ciphB.toString('hex'), parsedKey) : null;
      console.log('  doDecrypt:', dec);
    } catch (e) {
      console.log('  doDecrypt err:', e.message);
    }
  }

})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
