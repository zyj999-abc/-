#!/usr/bin/env node
/**
 * 94_jcap_wasm_exports.js
 *
 * 加载 wasm_crypto_bg.wasm，提取 CaptchaWebAssembly 类的所有方法。
 */

const fs = require('fs');
const path = require('path');

const WASM_PATH = '/tmp/jcap_dump/wasm_crypto_bg.wasm';

(async () => {
  const wasmBytes = fs.readFileSync(WASM_PATH);
  console.log(`WASM 大小: ${wasmBytes.length} bytes`);

  // 用 Node.js WebAssembly 加载
  // 但 wasm 通常需要 JS glue code（imports）
  // 看看 wasm imports
  const mod = await WebAssembly.compile(wasmBytes);
  const imports = WebAssembly.Module.imports(mod);
  console.log('\n=== WASM imports ===');
  imports.forEach(imp => console.log(`  ${imp.module}.${imp.name}: ${imp.kind}`));

  const exports = WebAssembly.Module.exports(mod);
  console.log('\n=== WASM exports ===');
  exports.forEach(exp => console.log(`  ${exp.name}: ${exp.kind}`));

  // 找 memory
  const memExport = exports.find(e => e.name === 'memory');
  if (memExport) {
    console.log('\nmemory export exists');
  }
})();
