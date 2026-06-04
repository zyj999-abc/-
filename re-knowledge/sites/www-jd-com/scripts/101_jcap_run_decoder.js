#!/usr/bin/env node
/**
 * 101_jcap_run_decoder.js
 *
 * 从 jcap_ujb96b.js 中提取 S 和 _ 函数（23246 和 23249）并直接执行
 * 用以验证 SDK 内部字符串混淆的解码结果
 */

// 1. 提取 SDK 的 S 和 _ 函数
// 2. 提取 U() 数组
// 3. 在 Node.js 中执行这些函数，调用 _(A, t) 来解码

const fs = require('fs');
const path = require('path');

const sdk = fs.readFileSync('/tmp/jcap_dump/jcap_ujb96b.js', 'utf-8');

// 找 U() 函数定义（字符串数组形式）
// 形式: function U(){var A=["z3rO",...];return (U=function(){return A})()}
const uFnMatch = sdk.match(/function U\(\)\{var A=\[("[^"]+",?)+\];return \(U=function\(\)\{return A\)\(\)\}/);
console.log('U() function found:', !!uFnMatch);

let uFn;
if (uFnMatch) {
  uFn = uFnMatch;
} else {
  // 直接提取 U 数组内容
  const arrayMatch = sdk.match(/function U\(\)\{var A=\[(["'][^"']+["'],?)+\]/);
  console.log('U() array only found:', !!arrayMatch);
  if (arrayMatch) {
    // 提取 array 部分
    const arrayStr = arrayMatch[0].replace('function U(){var A=', '');
    // 创建 U 函数
    uFn = { 0: `function U() { var A = ${arrayStr}; return (U = function() { return A; })(); }` };
  }
}

// 找 S 函数 (23246) - 形式: function S(A,t){return _(A-610,t)}
const sFnMatch = sdk.match(/function S\(A,t\)\{return _\(A-610,t\)\}/);
console.log('S function (23246) found:', !!sFnMatch);

// 找 _ 函数 (23249) - 形式: function _(A,t){var e=U();return _=function(t,n){var r=e[t-=213];...if(void 0===_.MiUOzJ){_.GwAvyR=function(A){...for(var t,e,n="",r="",o=0,i=0;e=A.charAt(i++);~e&&(t=o%4?64*t+e:e,o++%4)?n+=String.fromCharCode(255&t>>(-2*o&6)):0)e="abc..".indexOf(e);...return decodeURIComponent(r)};A=arguments;_.MiUOzJ=!0),o=t+e[0],i=A[o];return(i?r=i:(r=_.GwAvyR(r),A[o]=r),r},_(A,t)}
const underscoreMatch = sdk.match(/function _\(A,t\)\{var e=U\(\);return _=function\(t,n\)\{var r=e\[t-=213\];if\(void 0===_\.MiUOzJ\)\{[\s\S]{0,5000}?\},_\(A,t\)\}/);
console.log('_ function (23249) found:', !!underscoreMatch);
if (underscoreMatch) {
  console.log('_ function code (first 500):', underscoreMatch[0].substring(0, 500));
  console.log('...');
  console.log('_ function code (last 200):', underscoreMatch[0].slice(-300));
}

// 提取并执行 U/S/_ 函数
  if (uFn && sFnMatch && underscoreMatch) {
  // 在一个隔离的 Function 内执行
  // 用 U, S, _ 三个函数定义
  const code = `
    ${uFn[0]}
    ${underscoreMatch[0]}
    ${sFnMatch[0]}
  `;

  console.log('\n=== 测试 U() ===');
  const U = eval(`(function() { ${code}; return U; })()`);
  const UArr = U();
  console.log(`U() length: ${UArr.length}`);
  console.log(`U() array: ${JSON.stringify(UArr).substring(0, 200)}...`);

  console.log('\n=== 测试 _ 函数 ===');
  // 重新 eval 拿到 _ 函数
  const _fn = eval(`(function() { ${code}; return _; })()`);
  const S_fn = eval(`(function() { ${code}; return S; })()`);

  // 测试 _
  console.log(`_(213, 0) [U[0]] = "${_fn(213, 0)}"`);
  console.log(`_(214, 0) [U[1]] = "${_fn(214, 0)}"`);
  console.log(`_(220, 0) [U[7]] = "${_fn(220, 0)}"`);  // 期望 "TKData"
  console.log(`_(237, 0) [U[24]] = "${_fn(237, 0)}"`);  // 期望 "CTData"

  console.log('\n=== 全部 U 数组 decode ===');
  for (let i = 0; i < UArr.length; i++) {
    try {
      const decoded = _fn(213 + i, 0);
      console.log(`U[${i.toString().padStart(2)}] (raw: ${UArr[i].padEnd(20)}) → "${decoded}"`);
    } catch (e) {
      console.log(`U[${i}] error: ${e.message}`);
    }
  }

  console.log('\n=== 用 S 函数验证 k 方法名 ===');
  // k 函数: "get" + S(872, 449) + S(830, 210)
  // 实际 SDK 中 k 用内部 e 函数: e(A, t) = S(t - -608, A)
  // e(210, 222) = S(222 - -608, 210) = S(830, 210)
  // (function(A, t) { return S(A - -399, t); })(473, 449) = S(473 - -399, 449) = S(872, 449)

  const xxx = S_fn(872, 449);
  const yyy = S_fn(830, 210);
  console.log(`S(872, 449) = "${xxx}"`);
  console.log(`S(830, 210) = "${yyy}"`);
  console.log(`完整方法名: w["get" + "${xxx}" + "${yyy}"] = w.get${xxx}${yyy}`);

  // x 函数: S(847, 467) + "CTData"
  console.log(`\nx: S(847, 467) = "${S_fn(847, 467)}"`);

  // M 函数: e(1150, 1157) + "SEData"
  // e 内: S(A - 303, t) → e(1150, 1157) = S(1150 - 303, 1157) = S(847, 1157)
  console.log(`M: S(847, 1157) = "${S_fn(847, 1157)}"`);

  // F 函数: "getCSD" + S(830, 96)
  console.log(`F: S(830, 96) = "${S_fn(830, 96)}"`);

  // N 函数: "getInitialSt" + S(864, -679)
  console.log(`N: S(864, -679) = "${S_fn(864, -679)}"`);

  // R 函数: S(891, 690) + "se"
  console.log(`R: S(891, 690) = "${S_fn(891, 690)}"`);

  // G 函数: "tra" + S(876, 432) + r(574, 577)
  // r 内部: S(A - -263, t) → r(574, 577) = S(574 - -263, 577) = S(837, 577)
  console.log(`G: S(876, 432) = "${S_fn(876, 432)}"`);
  console.log(`G: S(837, 577) = "${S_fn(837, 577)}"`);
}
