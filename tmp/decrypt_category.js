const fs = require('fs');
const CryptoJS = require('crypto-js');

const KEY = '22946bc50fd63164b79df55070a85a92';
const IV = 'kaixin1234567890';

const enc = JSON.parse(fs.readFileSync('/tmp/category_2-1.json', 'utf8'));
console.log('status:', enc.status);

const std = enc.data.replace(/-/g, '+').replace(/_/g, '/');
const cp = CryptoJS.lib.CipherParams.create({ciphertext: CryptoJS.enc.Base64.parse(std)});
const key = CryptoJS.enc.Utf8.parse(KEY);
const iv = CryptoJS.enc.Utf8.parse(IV);
const d = CryptoJS.AES.decrypt(cp, key, {iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7});
const plain = d.toString(CryptoJS.enc.Utf8);

console.log('plaintext length:', plain.length);
fs.writeFileSync('/tmp/category_2-1.dec.json', plain);
console.log('=== first 2000 chars ===');
console.log(plain.substring(0, 2000));
console.log('=== last 500 chars ===');
console.log(plain.substring(plain.length - 500));
