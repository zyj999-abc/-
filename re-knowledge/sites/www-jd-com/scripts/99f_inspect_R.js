#!/usr/bin/env node
/**
 * 99f_jcap_inspect_R.js
 *
 * 检查 R 函数被 patch 后的实际代码
 */
const fs = require('fs');
const path = require('path');

const sdk = fs.readFileSync('/tmp/jcap_dump/jcap_ujb96b.js', 'utf-8');

// 找 jcap 的 R 函数
const rMatch = sdk.match(/R=function\(A,t\)\{try\{return w\?w\[function\(A,t\)\{return S\(t- -187,A\)\}\(704,690\)\+"se"\]\(A,t\):\{\}\}catch\(A\)\{return\{\}\}/);

console.log('R function original match:', !!rMatch);
if (rMatch) {
  console.log('R function code:');
  console.log(rMatch[0]);
  console.log('---');
} else {
  // 找 R=function 然后 w[function...S 模式
  const idx = sdk.indexOf('R=function(A,t){try{return w?w[function(A,t){return S(t- -187,A)}');
  console.log('R function index:', idx);
  if (idx > -1) {
    console.log('R function around idx:');
    console.log(sdk.substring(idx, idx + 250));
  }
}

// 应用 patch
let body = sdk;
const fVariants = [
  'R=function(A,t){try{return w?w[function(A,t){return S(t- -187,A)}(704,690)+"se"](A,t):{}}catch(A){return{}}}',
];
for (const v of fVariants) {
  if (body.includes(v)) {
    console.log('[PATCH] matched R variant');
    const repl = 'R=function(A,t){try{var __rMethod=(function(A,t){return S(t- -187,A)})(704,690)+"se";console.log("R_METHOD",__rMethod);return w?w[function(A,t){return S(t- -187,A)}(704,690)+"se"](A,t):{}}catch(A){console.log("R_ERR",A.message);return{}}}';
    body = body.replace(v, repl);
    break;
  }
}

// 找 patch 后的 R 函数
const rMatch2 = body.match(/R=function\(A,t\)\{try\{var __rMethod[\s\S]{0,300}\}/);
console.log('\nR function patched:');
console.log(rMatch2 ? rMatch2[0] : 'NOT FOUND');

// 找 S 函数 (23246) 验证
const sMatch = body.match(/function S\(A,t\)\{return _\(A-610,t\)\}/);
console.log('\nS function (23246) match:', !!sMatch);
if (sMatch) console.log(sMatch[0]);

// 找 _ 函数 (23249) 验证
const uMatch = body.match(/function _\(A,t\)\{var e=U\(\);return \(_=function\(t,n\)\{var r=e\[\(t-=213\)\];if\(void 0===_\.MiUOzJ\)/);
console.log('\n_ function (23249) match:', !!uMatch);

// 找 U() 函数 (23361) 验证
const uArrMatch = body.match(/function U\(\)\{var A=\["z3rO","z2v0"/);
console.log('U() function (23361) match:', !!uArrMatch);
