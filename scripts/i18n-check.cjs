#!/usr/bin/env node
// i18n anti-regression guard for Yuno (EN / FR / ES).
//
//   node scripts/i18n-check.cjs
//
// Hard-fails (exit 1) when a Spanish-breaking anti-pattern reappears:
//   1. A local helper that ignores the dictionary:  (fr, en) => language === 'fr' ? fr : en
//   2. A 2-language inline ternary with no Spanish branch:  language === 'fr' ? 'x' : 'y'
//      (lines that already branch on 'es', or delegate to translate()/t(), are fine)
//
// Also reports (informational, never fails) dictionary keys present in EN/FR but
// missing in ES, so the remaining gap stays visible without blocking CI.

const fs = require("fs");
const cp = require("child_process");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

function srcFiles() {
  return cp
    .execSync(`grep -rlE "language === 'fr'" ${SRC} --include=*.tsx --include=*.ts`, { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
}

let failures = 0;

// --- Check 1: raw ternary helper (no dictionary access) ---
const helperHits = [];
for (const f of srcFiles()) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/=>\s*\(?language === 'fr' \? fr : en\)?/.test(l)) helperHits.push(`${path.relative(ROOT, f)}:${i + 1}`);
  });
}
if (helperHits.length) {
  failures += helperHits.length;
  console.error(`\n❌ ${helperHits.length} raw ternary helper(s) — use translate(language, fr, en) from @/i18n/orgTranslate:`);
  helperHits.forEach((h) => console.error("   " + h));
}

// --- Check 2: 2-language inline ternary with no Spanish branch ---
const ternHits = [];
for (const f of srcFiles()) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    // a line that branches on 'fr' to pick between two string/template literals,
    // but never mentions 'es' and is not a dictionary delegation
    if (!/language === 'fr' \?/.test(l)) return;
    if (/=== 'es'/.test(l) || /translate\(/.test(l) || /\bt\(/.test(l)) return;
    if (/language === 'fr' \? (`[^`]*`|"[^"]*"|'[^']*') : (`[^`]*`|"[^"]*"|'[^']*')/.test(l)) {
      ternHits.push(`${path.relative(ROOT, f)}:${i + 1}  ${l.trim().slice(0, 90)}`);
    }
  });
}
if (ternHits.length) {
  failures += ternHits.length;
  console.error(`\n❌ ${ternHits.length} 2-language inline ternary(ies) with no Spanish branch — add a language === 'es' branch:`);
  ternHits.forEach((h) => console.error("   " + h));
}

// --- Report: dictionary ES coverage ---
try {
  const data = fs.readFileSync(path.join(SRC, "i18n/data.ts"), "utf8").split("\n");
  const bounds = {};
  data.forEach((l, i) => { const m = l.match(/^  (en|es|fr): \{/); if (m) bounds[m[1]] = i + 1; });
  const order = Object.entries(bounds).sort((a, b) => a[1] - b[1]);
  const sec = (name) => {
    const start = bounds[name];
    const after = order.filter(([, s]) => s > start).map(([, s]) => s).sort((a, b) => a - b)[0] || data.length + 1;
    const set = new Set();
    for (let i = start; i < after - 1; i++) { const m = data[i].match(/^\s*['"]([^'"]+)['"]\s*:/); if (m) set.add(m[1]); }
    return set;
  };
  const en = sec("en"), es = sec("es"), fr = sec("fr");
  const missing = [...new Set([...en, ...fr])].filter((k) => !es.has(k));
  console.log(`\nℹ️  Dictionary: en=${en.size} es=${es.size} fr=${fr.size} — ${missing.length} key(s) present in EN/FR but missing in ES.`);
  if (missing.length) console.log("   (run with VERBOSE=1 to list)");
  if (process.env.VERBOSE) missing.forEach((k) => console.log("   - " + k));
} catch (e) {
  console.error("could not read i18n/data.ts:", e.message);
}

if (failures) {
  console.error(`\n💥 i18n check failed: ${failures} Spanish-breaking pattern(s). See above.\n`);
  process.exit(1);
}
console.log("\n✅ i18n check passed: no Spanish-breaking patterns.\n");
