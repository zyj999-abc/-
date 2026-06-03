#!/usr/bin/env node
/**
 * 93_jcap_decode_strings.js
 *
 * 不动 SDK，直接复制 S/_/U 函数到独立 Node 脚本。
 */

const fs = require('fs');
const sdk = fs.readFileSync('/tmp/jcap_dump/jcap_ujb96b.js', 'utf-8');

// 从 SDK 提取 U 数组（在 23361-23425 行）
const lines = sdk.split('\n');
const uBlock = lines.slice(23360, 23424).join('\n');
const stringRe = /"([^"\\]*)"/g;
const arr = [];
let sm;
while ((sm = stringRe.exec(uBlock)) !== null) arr.push(sm[1]);
console.log(`U() 数组: ${arr.length} 个字符串`);

// 复制 _ 函数 - 完整复制 23270-23310
// 替代: 直接用 SDK 的 _ 函数定义在 eval 内

// 简单：用 `vm` 模块在 sandbox 中执行 S 函数
const vm = require('vm');
const sandbox = {
  console: console,
  U: arr,
};
// 给 SDK 注入 wrapper，让 U 数组直接被 U() 使用
const U_function = `var U = function() { var A = ${JSON.stringify(arr)}; return (U = function() { return A; })(); };`;

vm.createContext(sandbox);
vm.runInContext(U_function, sandbox);

// 复制 S 和 _ 函数
// S(A, t) { return _(A - 610, t); }
// _(t, n) { ... return U_ARR[t - 213] 这里是 strings[t - 213] ... }
const S_function = `
function S(A, t) { return _(A - 610, t); }

function _(t, n) {
  t -= 213;
  if (this.___cache === undefined) this.___cache = {};
  if (this.___cache[t] === undefined) {
    var enc = U[t];
    if (enc === undefined) return undefined;
    var GwAvyR = function(A) {
      var t2, e, n2 = "", r = "", o = 0, i = 0;
      for (; (e = A.charAt(i++)); ~e && ((t2 = o % 4 ? 64 * t2 + e : e), o++ % 4) ? (n2 += String.fromCharCode(255 & (t2 >> ((-2 * o) & 6)))) : 0) {
        e = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=".indexOf(e);
      }
      for (var a = 0, c = n2.length; a < c; a++) r += "%" + ("00" + n2.charCodeAt(a).toString(16)).slice(-2);
      return decodeURIComponent(r);
    };
    try {
      this.___cache[t] = GwAvyR(enc);
    } catch (e) {
      this.___cache[t] = '!!!ERR:' + enc;
    }
  }
  return this.___cache[t];
}
`;
vm.runInContext(S_function, sandbox);

console.log('\n=== 解码 U 数组 ===');
const decoded = vm.runInContext(`
  var out = [];
  for (var i = 0; i < ${arr.length}; i++) {
    try { out.push(_(i + 213, 0)); } catch (e) { out.push('ERR'); }
  }
  JSON.stringify(out);
`, sandbox);
const arr_decoded = JSON.parse(decoded);
arr_decoded.forEach((s, i) => console.log(`  [${i}] ${JSON.stringify(s)}`));

console.log('\n=== k 函数 (23206) ===');
// 内部 IIFE (function(A, t) { return S(A - -399, t); })(473, 449) = S(473 - -399, 449) = S(872, 449)
// e(210, 222) = S(222 - -608, 210) = S(830, 210)
const s1 = vm.runInContext('S(872, 449)', sandbox);
const s2 = vm.runInContext('S(830, 210)', sandbox);
console.log(`  S(872, 449) = ${JSON.stringify(s1)}`);
console.log(`  S(830, 210) = ${JSON.stringify(s2)}`);
console.log(`  k = w["get" + s1 + s2] = w.get${s1}${s2}`);

console.log('\n=== x 函数 (23236) ===');
// x = w[(function(A, t) { return S(t - -356, A); })(467, 491) + "CTData"]
// = w[S(491 - -356, 467) + "CTData"] = w[S(847, 467) + "CTData"]
const s3 = vm.runInContext('S(847, 467)', sandbox);
console.log(`  S(847, 467) = ${JSON.stringify(s3)}`);
console.log(`  x = w["${s3}CTData"]`);

console.log('\n=== CaptchaWebAssembly ===');
// w = new a["Cap" + e(533, 561) + "aWe" + e(550, 536) + e(548, 521) + "bly"](i)
// e(A, t) = S(t - 143, A)
const e533_561 = vm.runInContext('S(561 - 143, 533)', sandbox);
const e550_536 = vm.runInContext('S(536 - 143, 550)', sandbox);
const e548_521 = vm.runInContext('S(521 - 143, 548)', sandbox);
console.log(`  e(533, 561) = ${JSON.stringify(e533_561)}`);
console.log(`  e(550, 536) = ${JSON.stringify(e550_536)}`);
console.log(`  e(548, 521) = ${JSON.stringify(e548_521)}`);
console.log(`  w = new a.Cap${e533_561}aWe${e550_536}${e548_521}bly(i)`);

console.log('\n=== F 函数 (cs 加密, 在 25260) ===');
// cs: F([a, JSON.stringify(p)])
// F 在 SDK 内调用 w["set" + ...]([a, JSON.stringify(p)])
// 25260: cs: F([a, JSON["str" + i(302, 311) + "ingify"](p)])
// F 是 closure，从内部 module 找
// 让我看 25260 之前 F 定义

console.log('\n=== 25260 之前 F 定义 ===');
// 25240-25260
for (let i = 25200; i < 25270; i++) {
  if (lines[i].match(/F = function|cs: F\(|F = /)) {
    console.log(`${i+1}: ${lines[i].substring(0, 200)}`);
  }
}

// 找 wA.getSensorInfo
console.log('\n=== wA.getSensorInfo (25260) ===');
// wA["get" + i(273, 288) + "sor" + i(285, 314) + "o"]
// i(A, t) = S(A - 280, t)
const i273_288 = vm.runInContext('S(288 - 280, 273)', sandbox);
const i285_314 = vm.runInContext('S(314 - 280, 285)', sandbox);
console.log(`  wA[get${i273_288}sor${i285_314}o]`);

// 找 n.kTtiX (25260)
// n[i(280, 287) + "iX"]
// i(A, t) = S(A - 280, t)
const i280_287 = vm.runInContext('S(287 - 280, 280)', sandbox);
console.log(`  n.kTtiX = n.${i280_287}ix`);

// 找 n.mLaSC (25260)
// n[o(-264, -293) + "SC"]
// o(A, t) = S(t - 143, A)
const o_minus264_minus293 = vm.runInContext('S(-293 - 143, -264)', sandbox);
console.log(`  n.mLaSC = n.${o_minus264_minus293}sc`);

console.log('\n=== HkkKM / sPxgb (25260) ===');
// n.HkkKM, n.sPxgb
console.log('找 n.HkkKM / n.sPxgb 字符串');
for (let i = 25230; i < 25270; i++) {
  if (lines[i].match(/HkkKM|sPxgb|kTtiX|mLaSC/)) {
    console.log(`${i+1}: ${lines[i].substring(0, 200)}`);
  }
}
