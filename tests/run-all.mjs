// 测试运行器：发现并运行 tests/test-*.mjs，汇总结果
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function makeHarness(moduleName) {
  const results = [];
  const record = (pass, msg, extra) => {
    results.push({ pass, msg, extra });
    if (!pass) process.exitCode = 1;
  };
  return {
    t: {
      ok(cond, msg) { record(Boolean(cond), msg); },
      eq(a, b, msg) { record(deepEqual(a, b), msg, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); },
      close(a, b, eps, msg) { record(Math.abs(a - b) <= eps, msg, `got=${a} want≈${b} eps=${eps}`); },
      throws(fn, msg) {
        try { fn(); record(false, msg, 'no error thrown'); }
        catch { record(true, msg); }
      },
    },
    results,
    moduleName,
  };
}

async function main() {
  const files = fs.readdirSync(__dirname)
    .filter((f) => /^test-.*\.mjs$/.test(f))
    .sort();
  if (files.length === 0) {
    console.error('no test files found');
    process.exit(1);
  }
  let total = 0;
  let failed = 0;
  const failures = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(__dirname, f)).href);
    const h = makeHarness(f);
    try {
      await mod.run(h.t);
    } catch (e) {
      h.t.ok(false, `${f} threw: ${e.message}`);
    }
    const modFailed = h.results.filter((r) => !r.pass);
    total += h.results.length;
    failed += modFailed.length;
    const mark = modFailed.length === 0 ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${f}  (${h.results.length - modFailed.length}/${h.results.length})`);
    for (const r of modFailed) {
      failures.push(`  ✗ [${f}] ${r.msg}${r.extra ? ' — ' + r.extra : ''}`);
    }
  }
  if (failures.length) {
    console.log('\n失败明细:');
    for (const line of failures) console.log(line);
  }
  console.log(`\n==== 测试汇总：${total - failed}/${total} 通过，${failed} 失败 ====`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
