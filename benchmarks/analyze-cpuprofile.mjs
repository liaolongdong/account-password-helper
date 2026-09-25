#!/usr/bin/env node
/**
 * `.cpuprofile` 离线归因脚本（self time + 调用链，不改测量口径）
 *
 * 为什么需要它：`measure-options-perf.mjs` 里的 Top-N 只按 self time 点名"哪个函数忙"，
 * 但压缩后的 Vue / Element Plus 内部函数名（如 `Ps`）无法直接对应到业务代码。
 * 要判断"是谁把它调用起来"，必须把 self time 沿 parent 链回填，
 * 看它由哪条业务路径（哪个组件的哪个渲染/更新）产生。
 *
 * 用法：
 *   node benchmarks/analyze-cpuprofile.mjs benchmarks/results/profile-xxx.cpuprofile
 *   node benchmarks/analyze-cpuprofile.mjs <file> --focus Ps --depth 12
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  process.stderr.write('用法：node benchmarks/analyze-cpuprofile.mjs <profile.cpuprofile> [--focus 名] [--depth N]\n');
  process.exit(1);
}
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DEPTH = Number(argOf('depth', 14));
const FOCUS = argOf('focus', '');

const prof = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const nodes = prof.nodes;
const samples = prof.samples;
const timeDeltas = prof.timeDeltas;

const byId = new Map();
for (const n of nodes) byId.set(n.id, n);
// parent 指针：profiles 只有 children，自建 parent 映射
const parentOf = new Map();
for (const n of nodes) {
  for (const c of n.children || []) parentOf.set(c, n.id);
}

const label = n => {
  const cf = n.callFrame || {};
  const fn = cf.functionName || '(anonymous)';
  const line = `${cf.url || ''}:${cf.lineNumber ?? -1}:${cf.columnNumber ?? 0}`;
  return `${fn} @ ${line}`;
};

/** self time：按「函数名 + 文件:行」聚合，同一函数的多个节点合并 */
const self = new Map();
let total = 0;
samples.forEach((id, i) => {
  const n = byId.get(id);
  if (!n) return;
  const dt = Math.max(0, timeDeltas[i] ?? 0) / 1000; // μs → ms
  total += dt;
  const key = label(n);
  self.set(key, (self.get(key) ?? 0) + dt);
});

const sorted = [...self.entries()].sort((a, b) => b[1] - a[1]);

process.stdout.write(`== ${path.basename(file)}：总采样 ${total.toFixed(0)}ms / ${samples.length} 帧 ==\n`);
process.stdout.write('-- self time Top 25 --\n');
for (const [k, ms] of sorted.slice(0, 25)) {
  process.stdout.write(`  ${((ms / total) * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(7)}ms  ${k}\n`);
}

/**
 * 调用链归因：对每个 self-time 采样，向上走 parent 链（跳过同名帧），
 * 得到「最近的外部调用者」分布 + 完整链 Top-N。
 */
const focusKey = sorted.find(([k]) => (FOCUS ? k.startsWith(`${FOCUS} @`) : true))?.[0];
if (!focusKey) {
  process.stdout.write(`\n未匹配到 focus=${FOCUS}\n`);
  process.exit(0);
}
process.stdout.write(`\n== 归因目标：${focusKey} ==\n`);

const focusName = focusKey.split(' @ ')[0];
const callers = new Map();
const chains = new Map();
samples.forEach((id, i) => {
  const n = byId.get(id);
  if (!n || label(n) !== focusKey) return;
  const dt = Math.max(0, timeDeltas[i] ?? 0) / 1000;
  const chain = [];
  let cur = parentOf.get(n.id);
  let guard = 0;
  while (cur !== undefined && guard++ < 200) {
    const p = byId.get(cur);
    if (!p) break;
    const l = label(p);
    if (!l.startsWith(`${focusName} @`)) chain.push(l);
    if (chain.length >= DEPTH) break;
    cur = parentOf.get(cur);
  }
  const immediate = chain[0] ?? '(root)';
  callers.set(immediate, (callers.get(immediate) ?? 0) + dt);
  const ck = chain.slice(0, 6).join('\n      ← ');
  chains.set(ck, (chains.get(ck) ?? 0) + dt);
});

const focusTotal = sorted.find(([k]) => k === focusKey)?.[1] ?? 0;
process.stdout.write(`-- 最近调用者分布（占该函数 self time）--\n`);
for (const [k, ms] of [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  process.stdout.write(
    `  ${((ms / focusTotal) * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(7)}ms  ${k}\n`,
  );
}
process.stdout.write(`-- 完整链 Top 4（各 ${DEPTH} 层内）--\n`);
for (const [k, ms] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
  process.stdout.write(
    `  ${((ms / focusTotal) * 100).toFixed(1)}% ${ms.toFixed(0)}ms\n      ${k.replace(/\n/g, '\n      ')}\n`,
  );
}
