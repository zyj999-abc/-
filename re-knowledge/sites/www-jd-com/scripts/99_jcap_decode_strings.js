#!/usr/bin/env node
/**
 * 99_jcap_decode_strings.js
 *
 * 复现 jcap SDK 的字符串解码逻辑（U() + S + _ 函数）
 * 用以计算 k/x/M/F/N 函数实际调用的 w["getXXX"] 方法名
 */

// U() 数组（从 jcap_ujb96b.beauty.js 第 23361 行复制）
const U_ARRAY = [
  "z3rO", "z2v0", "D3jH", "Bsbj", "vMfp", "zsbU", "CMvJ", "mtmYmdmWnfjpywrJCW",
  "Aw5P", "BNn0", "B3qG", "ntG1Chj5wu9X", "BgvU", "CMv0", "Ewv0", "CuLh", "yw1L",
  "ndqWu1f3tMvm", "yxrL", "zwqG", "zwzP", "BMvK", "D2fZ", "DgfU", "nta0mteZngXRrM1uzq",
  "BgL6", "veTe", "mZa0ody2y3nkz3zs", "pt09", "Dw5K", "BNnM", "CgfY", "DgnO", "DgLH",
  "uKr3", "zM5o", "DxjU", "mZyYnJe2mhnqCKv4vW", "yxbW", "yxrH", "zwf0", "mJK2nJzWrez6sgK",
  "BMfT", "ntG2mKzTuM9nBG", "y2vj", "ywjY", "B3jT", "C2vT", "B3jK", "yKfZ", "rM1p", "ChjL",
  "BMnL", "mJmZnJy5mhLjyMnzDG", "Bg9N",
];

// 复现 _ 函数（标准 base64 解码 + percent-decode）
// SDK 写法：for(init; (e = A.charAt(i++)); step) body
// 1. test: e = char
// 2. body: e = indexOf(char) 转为 0..63
// 3. step: ~e && ((t = o%4 ? 64*t+e : e), o++%4) ? push char : 0
function _base64Decode(A) {
  const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";
  let t, e, n = "", r = "", o = 0, i = 0;
  for (; (e = A.charAt(i++)); ) {
    e = CHARS.indexOf(e);
    if (~e && ((t = o % 4 ? 64 * t + e : e), o++ % 4)) {
      n += String.fromCharCode(255 & (t >> ((-2 * o) & 6)));
    }
  }
  for (let a = 0, c = n.length; a < c; a++) {
    r += "%" + ("00" + n.charCodeAt(a).toString(16)).slice(-2);
  }
  return decodeURIComponent(r);
}

// 复现 _ 函数完整版
const _cache = new Map();
function _(A, t) {
  const key = A;
  if (_cache.has(key)) return _cache.get(key);
  // t -= 213，所以 idx = A - 213
  const idx = A - 213;
  if (idx < 0 || idx >= U_ARRAY.length) {
    console.error(`[ERR] _(A=${A}, t=${t}) idx ${idx} out of range`);
    return null;
  }
  const r = U_ARRAY[idx];
  let decoded;
  if (r.length > 4) {
    // 长字符串看起来是 base64-encoded JS code（如 "mtmYmdmWnfjpywrJCW"）
    // 这是 jcap 使用的双层混淆：base64 + 部分 percent
    // 但这些可能是已经 partial-decoded 的代码片段
    // 直接原样返回，因为 jcap 内部只用它作参数，不做最终解码
    decoded = r;
  } else {
    // 4 字符以内是 base64-encoded 短字符串
    decoded = _base64Decode(r);
  }
  _cache.set(key, decoded);
  return decoded;
}

// 复现 S 函数：S(A, t) = _(A - 610, t)
function S(A, t) {
  return _(A - 610, t);
}

console.log("=== 测试 _ 函数（全部） ===");
for (let i = 0; i < U_ARRAY.length; i++) {
  const raw = U_ARRAY[i];
  let decoded;
  try {
    decoded = _base64Decode(raw);
  } catch (e) {
    decoded = "[err]";
  }
  console.log(`U[${i.toString().padStart(2)}] = ${JSON.stringify(raw).padEnd(28)} -> ${JSON.stringify(decoded)}`);
}

console.log("\n=== 计算 k 函数中 e(210, 222) ===");
// k 中: e(A, t) = S(t - -608, A) = _(t - -608 - 610, A) = _(t - 2, A)
// e(210, 222) = _(222 - 2, 210) = _(220, 210)
console.log(`e(210, 222) = _(220, 210) = U[${220-213}] = ${_(220, 210)}`);

console.log("\n=== 计算 k 函数中 (function(A,t){return S(A - -399, t);})(473, 449) ===");
// S(473 - -399, 449) = S(872, 449) = _(872 - 610, 449) = _(262, 449)
console.log(`S(872, 449) = _(262, 449) = U[${262-213}] = ${_(262, 449)}`);

console.log("\n=== 拼接 w[\"get\" + xxx + yyy] ===");
const xxx = _(262, 449);
const yyy = _(220, 210);
console.log(`完整方法名: w["get" + "${xxx}" + "${yyy}"]`);
console.log(`即: w.${"get" + xxx + yyy}`);

// 已知真实方法名:
const KNOWN = {
  220: "TKData",  // _(220, 210) → U[7] = "mtmYmdmWnfjpywrJCW" → "TKData"
  237: "CTData",  // _(237, 467) → U[24] = "nta0mteZngXRrM1uzq" → "CTData"
  254: "usData",  // _(254, -679) → U[41] = "mJK2nJzWrez6sgK" → "usData" (used in "getInitialSt" + ...usData)
  // F 函数: getCSD + _(220, 96) → w.getCSD<TKData> ?
  // 实际上 w["getCSD" + _(220, 96)] 应该是 w.getCSD<TKData> 也可能直接是 w.getCSDData
  // M 函数: _(237, 1157) + "SEData" = "CTData" + "SEData" = "CTDataSEData" - 看起来不太对
  // 重新计算 M
};

// 重新计算
console.log("\n=== 已知结果 ===");
console.log("k: w.getTKData (input array [si, st, encoded_xyList, touchList_JSON])");
console.log("x: w.getCTData (input array [si, deviceInfo_JSON])");

// F 函数 - 1320304ROadcs
console.log("\nF 函数: w.getCSD + _(220, 96)");
console.log(`_(220, 96) = U[7] = "mtmYmdmWnfjpywrJCW" → "TKData"? 但 w["getCSD" + "TKData"] = w.getCSDTKData 不对`);
console.log("应该 w.getCSDData 之类 - 让我重新看代码");

// 看 23298 行 F 函数
console.log("\n实际 F 函数代码:");
console.log(`
  F = function (A) {
    try {
      return w
        ? w[
            "getCSD" +
              (function (A, t) {
                return S(t - -737, A);
              })(96, 93)
          ](A)
        : "";
    } catch (A) {
      return "";
    }
  },
`);
console.log("(function(A, t){return S(t - -737, A);})(96, 93)");
console.log("= S(93 - -737, 96) = S(830, 96) = _(830 - 610, 96) = _(220, 96)");
console.log("_(220, 96) → U[7] → ?");
console.log("如果 U[7] = 'TKData'，则 w.getCSDTKData - 这不对");
console.log("可能 U[7] 解码后是 'ata' 或 'Data' - 让我猜: w.getCSDData");

// M 函数
console.log("\nM 函数代码 (23281 行):");
console.log(`
  M = function (A) {
    var t = {};
    function e(A, t) {
      return S(A - 303, t);
    }
    ((t["fnN" + e(1165, 1173)] = M.name),
      b[...](t));
    try {
      return w ? w[e(1150, 1157) + "SEData"](A) : "";
    } catch (A) {
      return "";
    }
  },
`);
console.log("e(1150, 1157) = S(1150 - 303, 1157) = S(847, 1157) = _(237, 1157)");
console.log("_(237, 1157) = U[24] - 如果 U[24] = 'CTData' 那 M 是 w.getCTDataSEData - 不对");
console.log("M 应该是 w.getCSData (CS = Cookie State) 或类似");
console.log("让我猜: U[24] 实际解码后是 'D' 或 'Data'，M 是 w.getDSEData = w.getDSEData - 还是不对");

// 让我用 220-213=7 U[7] 对应 18 字符, U[24] 对应 18 字符（也是长字符串） → 可能是 'TKData' / 'CTData'
// 而 U[15] (4 字符) = 'qIG'，可能 = 'SE' (DSEData)
// U[43] (16 字符) 'ntG2mKzTuM9nBG' → ?
// 看 N 函数 23312 行: getInitialSt + ...
console.log("\nN 函数 (23312):");
console.log(`
  N = function (A) {
    ...
    return w ? w["getInitialSt" + (function(A,t){return S(A - -1517, t);})(-653, -679)](A) : "";
  }
`);
console.log("S(-653 - -1517, -679) = S(864, -679) = _(254, -679) = U[41]");
console.log("U[41] = 'mJK2nJzWrez6sgK' - 16 字符 → 应该是 'usData'");
console.log("所以 w.getInitialStatusData 或 w.getInitialStateData");

// R 函数 (23328)
console.log("\nR 函数 (23328):");
console.log(`
  R = function (A, t) {
    try {
      return w
        ? w[(function(A,t){return S(t - -187, A);})(704, 690) + "se"](A, t)
        : {};
    } catch (A) {
      return {};
    }
  },
`);
console.log("S(704 - -187, 690) = S(891, 690) = _(281, 690) = U[68] - 越界（U 只有 55 项）");
console.log("可能是 U[50] = 'FmO' -> ?");
console.log("R + 'se' = w.<FmO>se - 应该是 w.parse 或类似");

// G 函数 (23341)
console.log("\nG 函数 (23341):");
console.log(`
  G = function (A, t, e) {
    var n = {};
    function r(A, t) {
      return S(A - -263, t);
    }
    ((n[r(563, 541) + "ame"] = G.name), (n.recordOnce = !0), b.record(n));
    try {
      return w
        ? w["tra" + (function(A,t){return S(t - -433, A);})(432, 443) + r(574, 577)](A, t, e)
        : 0;
    } catch (A) {
      return 0;
    }
  },
`);
console.log("S(443 - -433, 432) = S(876, 432) = _(266, 432) = U[53]");
console.log("U[53] = 'mJmZnJy5mhLjyMnzDG' - 18 字符 → 应该是 'ceIv' 或 'ceI' + 'nv' (event) → 'ceI' + 'nv' = 'nsIn' ");
