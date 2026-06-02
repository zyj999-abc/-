// 第二十五轮：用 JSEncrypt (RSA) 解密
const JSEncrypt = require('jsencrypt');
const cryptoJS = require('crypto-js');
const fs = require('fs');

(async () => {
  const data1 = JSON.parse(fs.readFileSync('/tmp/17c_v18/3_vod_raw.json', 'utf-8'));
  const cipher = data1.body.data;
  const rsaEnc = data1.body.key;
  console.log('=== cipher len:', cipher.length, 'rsaEnc len:', rsaEnc.length);

  // 提取 RSA 公钥
  const code = fs.readFileSync('/workspace/legacy.js', 'utf-8');
  const pubMatch = code.match(/MIIB[A-Za-z0-9+/=]{50,}/);
  const pub = pubMatch[0];
  console.log('=== RSA 公钥:');
  console.log(pub);

  // 试 JSEncrypt 用公钥做 decrypt
  const crypt = new JSEncrypt();
  crypt.setPublicKey(pub);

  // 先看 cipher 长度（base64 decode 后）
  const ciphBytes = Buffer.from(rsaEnc, 'base64');
  console.log('\n=== cipher decoded len:', ciphBytes.length);

  // 试 1: JSEncrypt 字符串 decrypt
  let dec1;
  try {
    dec1 = crypt.decrypt(rsaEnc);
    console.log('  decrypt(rsaEnc):', dec1);
  } catch (e) { console.log('  decrypt err:', e.message); }

  // 试 2: JSEncrypt hex decrypt
  let dec2;
  try {
    dec2 = crypt.decrypt(ciphBytes.toString('hex'));
    console.log('  decrypt(hex):', dec2);
  } catch (e) { console.log('  decrypt hex err:', e.message); }

  // 试 3: 看 JSEncrypt 默认 key size
  console.log('  default key size:', crypt.default_key_size, '=', crypt.default_key_size * 8, 'bit');
  console.log('  default public exponent:', crypt.default_public_exponent);

  // 试 4: RSA 512 位 - 用更小的公钥
  // 64 字节 = 512 bit - 用更小的公钥或换算法
  // 实际上 JSEncrypt 默认生成 1024 bit 公钥
  // 公钥 base64 decode 后 460 字符 / 4*3 = 345 字节
  const pubBuf = Buffer.from(pub, 'base64');
  console.log('  pub key binary len:', pubBuf.length);

  // 看 ASN.1 解析公钥
  // MIIB... 是 DER 编码
  // 0x30 SEQUENCE, 0x02 INTEGER, 0x03 BIT STRING
  // 模数 n 在 0x02 后
  let pos = 0;
  console.log('  pub DER first bytes:', pubBuf.slice(0, 20).toString('hex'));
  if (pubBuf[0] === 0x30) {
    // SEQUENCE
    pos = 2;
    if (pubBuf[1] & 0x80) pos += (pubBuf[1] & 0x7F);
    // 算法 ID
    if (pubBuf[pos] === 0x30) {
      pos += 2;
      if (pubBuf[pos-1] & 0x80) pos += (pubBuf[pos-1] & 0x7F);
    }
    // BIT STRING
    if (pubBuf[pos] === 0x03) {
      pos += 2;
      if (pubBuf[pos-1] & 0x80) pos += (pubBuf[pos-1] & 0x7F);
      // 0x00 padding
      pos++;
    }
    // SEQUENCE of two INTEGERs (modulus, exponent)
    if (pubBuf[pos] === 0x30) {
      pos += 2;
    }
    // INTEGER modulus
    if (pubBuf[pos] === 0x02) {
      pos++;
      let len = pubBuf[pos]; pos++;
      if (len & 0x80) {
        const n = len & 0x7F;
        len = 0;
        for (let i = 0; i < n; i++) len = (len << 8) | pubBuf[pos++];
      }
      // skip leading 0x00
      if (pubBuf[pos] === 0x00) { pos++; len--; }
      const n = pubBuf.slice(pos, pos + len);
      console.log('  modulus bits:', n.length * 8);
      pos += len;
    }
    // INTEGER exponent
    if (pubBuf[pos] === 0x02) {
      pos++;
      let len = pubBuf[pos]; pos++;
      if (len & 0x80) {
        const n2 = len & 0x7F;
        len = 0;
        for (let i = 0; i < n2; i++) len = (len << 8) | pubBuf[pos++];
      }
      const e = pubBuf.slice(pos, pos + len);
      console.log('  exponent:', e.toString('hex'));
    }
  }

  // 5. 现在看实际页面里跑 jh 的结果
  // 用 puppeteer 真实抓
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
