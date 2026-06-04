#!/usr/bin/env node
/**
 * 100_jcap_wasm_exports_check.js
 *
 * 直接加载 wasm_crypto_bg.wasm 看看 exports
 */

const fs = require('fs');
const path = require('path');

(async () => {
  const wasmBuffer = fs.readFileSync('/tmp/jcap_dump/wasm_crypto_bg.wasm');
  const wasmModule = await WebAssembly.compile(wasmBuffer);
  const exportsList = WebAssembly.Module.exports(wasmModule);
  const importsList = WebAssembly.Module.imports(wasmModule);

  console.log('=== WASM Exports ===');
  for (const e of exportsList) {
    console.log(`  ${e.name}: ${e.kind}`);
  }

  console.log('\n=== WASM Imports ===');
  for (const i of importsList) {
    console.log(`  ${i.module}.${i.name}: ${i.kind}`);
  }

  // 打印 searchTKData / getTKData / getCTData / getCSData / getSDData / getInitialStatusData
  console.log('\n=== 搜索相关方法 ===');
  const names = ['TK', 'CT', 'CS', 'CSD', 'Status', 'Initial', 'Trace', 'parse', 'getInitialSt', 'use', 'tra', 'getC'];
  for (const n of names) {
    const found = exportsList.filter(e => e.name.toLowerCase().includes(n.toLowerCase()));
    if (found.length) console.log(`  含 "${n}":`, found.map(f => f.name));
  }
})();
