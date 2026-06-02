// 第二十四轮：用 sm-crypto 直接跑 jh 完整逻辑
const sm = require('sm-crypto');
const cryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');

(async () => {
  // 加载真实数据
  const data1 = JSON.parse(fs.readFileSync('/tmp/17c_v18/3_vod_raw.json', 'utf-8'));
  const cipher = data1.body.data;
  const sm2Enc = data1.body.key;
  console.log('=== cipher len:', cipher.length, 'sm2Enc len:', sm2Enc.length);

  // 提取 SM2 公钥
  const code = fs.readFileSync('/workspace/legacy.js', 'utf-8');
  const sm2PubMatch = code.match(/MIIB[A-Za-z0-9+/=]{50,}/);
  const sm2Pub = sm2PubMatch[0];
  console.log('SM2 pub len:', sm2Pub.length);

  // 1. 解析 SM2 公钥为对象
  const pubKey = sm.sm2.publicKeyFromPem ?
    sm.sm2.publicKeyFromPem('-----BEGIN PUBLIC KEY-----\n' + sm2Pub + '\n-----END PUBLIC KEY-----') :
    null;
  console.log('pubKey:', !!pubKey, pubKey ? 'parsed' : 'failed');

  // 2. 试 sm.sm2.decrypt (规范 API - 需要私钥)
  try {
    // sm-crypto 0.x: sm2.decrypt(encryptData, privateKey)
    // sm-crypto 1.x: sm2.doDecrypt(encryptData, privateKey, {publicKey})
    // 我们只有公钥
    const dec1 = sm.sm2.decrypt ? sm.sm2.decrypt(Buffer.from(sm2Enc, 'base64').toString('hex'), pubKey) : 'no dec method';
    console.log('sm2.decrypt:', dec1);
  } catch (e) {
    console.log('sm2.decrypt err:', e.message);
  }

  // 3. 用 sm.sm2.doDecrypt (新版 API)
  try {
    const dec2 = sm.sm2.doDecrypt(Buffer.from(sm2Enc, 'base64').toString('hex'), pubKey);
    console.log('sm2.doDecrypt:', dec2);
  } catch (e) {
    console.log('sm2.doDecrypt err:', e.message);
  }

  // 4. 用 private key 模式: 把 pubKey 当 privKey 用
  try {
    // sm-crypto API: doDecrypt(msg, privateKey, {publicKey})
    // 假设 server 用公钥加密，client 用公钥"解密"（非标准）
    const dec3 = sm.sm2.doDecrypt(Buffer.from(sm2Enc, 'base64').toString('hex'), pubKey, {publicKey: pubKey});
    console.log('doDecrypt w/ public as both:', dec3);
  } catch (e) {
    console.log('doDecrypt w/ public as both err:', e.message);
  }

  // 5. 试不同的 sm-crypto API
  console.log('\n=== 5. 试 sm-crypto 各种 API ===');
  const sm2CipherHex = Buffer.from(sm2Enc, 'base64').toString('hex');
  console.log('sm2Cipher hex len:', sm2CipherHex.length);

  // sm.sm2 是 object
  console.log('sm.sm2 keys:', Object.keys(sm.sm2 || {}));

  // 试 generateKeyPair + 用 pubKey 解密（也许 sm-crypto 不区分公私钥）
  for (const fn of ['decrypt', 'doDecrypt', 'verify']) {
    if (sm.sm2[fn]) {
      try {
        const r = sm.sm2[fn](sm2CipherHex, pubKey, {publicKey: pubKey});
        console.log('  ' + fn + ':', r);
      } catch (e) {
        console.log('  ' + fn + ' err:', e.message);
      }
    }
  }

  // 6. 用 sm2 库的 doCrypt 自己解
  console.log('\n=== 6. sm2.doCrypt + doDecrypt 详细参数 ===');
  // sm2 加密输出: C1C3C2 (C1 是公钥点 64 字节, C3 是 hash 32 字节, C2 是密文)
  // sm2 加密输出: C1C2C3 (新国密)
  // 看 sm2 cipher 长度 64 字节 -> 不对 SM2 输出长度
  // 实际 64 字节 = 16*4 字节，可能是 SM4 数据？
  // 64 字节 = 4 个 SM4 块（每个 16 字节）
  // 也许 key 不是 SM2 加密的，是 SM4 加密的！

  // 试 SM4-CBC with key = sm2Pub
  console.log('\n=== 7. 试 SM4 解密 key ===');
  for (const kS of [0, 16, 32, 48]) {
    for (const iS of [0, 16, 32, 48]) {
      if (iS + 16 > 64 || kS + 16 > 64) continue;
      const k = sm2Pub.slice(kS, kS+16);  // 16 字符 base64
      const iv = sm2Pub.slice(iS, iS+16);
      try {
        const dec = sm.sm4.decrypt(Buffer.from(cipher, 'base64').toString('hex'), Buffer.from(k).toString('hex'));
        const preview = dec.slice(0, 100);
        if (/^[\x20-\x7E\u4e00-\u9fa5]/.test(preview)) {
          console.log('  [SM4-FOUND] kS=' + kS + ' iS=' + iS + ': ' + preview);
        }
      } catch (e) {}
    }
  }

  // 8. 用 jh 完整算法：直接调用 sm.sm2 函数
  console.log('\n=== 8. 试 jh 完整算法模拟 ===');
  // jh 步骤：
  // 1) Xu = new sm.sm2
  // 2) Xu.setPublicKey(sm2Pub)
  // 3) Xu.decrypt(key) -> AES key
  // 4) reverse(AES key)[:16] -> IV
  // 5) AES-CBC-PKCS7 decrypt(data)

  // 试 Xu.decrypt = sm.sm2.decrypt (sm-crypto 1.x API)
  let aesKey = null;
  try {
    const cipherHex = Buffer.from(sm2Enc, 'base64').toString('hex');
    // sm.sm2.decrypt 需要 privateKey
    // 但 jh 用了 setPublicKey + decrypt - 表明 sm-crypto 允许 pubKey decrypt
    // 可能 sm-crypto 的 SM2 实现把 pubKey 当 privKey 用（不规范但前端能跑）
    aesKey = sm.sm2.decrypt(cipherHex, pubKey);
    console.log('  sm.sm2.decrypt(pubKey) ->', aesKey);
  } catch (e) {
    console.log('  sm.sm2.decrypt(pubKey) err:', e.message);
  }

  if (aesKey) {
    // AES 解密
    const nArr = aesKey.split('');
    nArr.reverse();
    const iv = nArr.join('').substring(0, 16);
    console.log('  iv:', iv);

    try {
      const dec = cryptoJS.AES.decrypt(cipher, cryptoJS.enc.Utf8.parse(aesKey), {
        iv: cryptoJS.enc.Utf8.parse(iv),
        padding: cryptoJS.pad.Pkcs7,
      });
      const plain = cryptoJS.enc.Utf8.stringify(dec);
      console.log('  [DECRYPTED] 前 500:', plain.slice(0, 500));
    } catch (e) {
      console.log('  AES err:', e.message);
    }
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
