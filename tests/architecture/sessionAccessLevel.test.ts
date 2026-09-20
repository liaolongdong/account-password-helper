/**
 * storage.session accessLevel 静态守卫
 *
 * 安全基线：`chrome.storage.session` 默认 `accessLevel = TRUSTED_CONTEXTS`，
 * 仅扩展自身可信上下文（background / popup / options / sidepanel）可读，
 * content script（在宿主页面 JS 环境中运行）不可读。这是「TOTP secret / 会话
 * 数据密钥 / 快照等敏感短期缓存不泄漏到网页」的关键边界。
 *
 * 一旦任何源码调用 `chrome.storage.session.setAccessLevel({ accessLevel:
 * 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })`（或任何形式的 setAccessLevel），
 * 就等于把这层保护关掉——网页脚本可通过 `chrome.runtime.sendMessage`
 * 之类的间接路径或注入的 content script 读到 session 内存中的敏感数据。
 *
 * 本测试扫描运行时源码（utils / entrypoints / composables / components），断言：
 * 1. 无 `setAccessLevel` 调用（任何形式的 accessLevel 覆写都算）；
 * 2. 无 `TRUSTED_AND_UNTRUSTED` 字符串出现（即使命中在注释里也提示评审）；
 * 3. 允许在文档 / 测试 / 项目根配置里提到（例如本文件），仅扫运行时源码目录。
 *
 * 若某天确有正当需求要打开该 API，必须显式评估影响并把相关代码路径加入
 * 白名单——但更常见的正确做法是使用 storage.local + 显式加密。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
/**
 * 运行时源码目录（不含 tests / docs / 构建产物 / 项目脚本）
 *
 * `components/` 必须在内：它是随 options / sidepanel / popup 打包的运行时产物，
 * 组件里一句 `chrome.storage.session.setAccessLevel(...)` 与在 background 里写
 * 效果完全相同（同一个扩展进程上下文），漏掉它等于给守卫留一个静默盲区。
 */
const RUNTIME_DIRS = ['utils', 'entrypoints', 'composables', 'components'];
const RUNTIME_EXT = /\.(ts|vue|js)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (RUNTIME_EXT.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 逐目录留痕，便于断言「清单被削减后守卫静默缩小范围」这种情况 */
const scannedByDir = RUNTIME_DIRS.map(dir => ({ dir, sources: walk(path.join(ROOT, dir)) }));
const files = scannedByDir.flatMap(s => s.sources);

/** 在扫描范围内找出包含 `needle` 的文件（返回相对 ROOT 的路径，便于失败信息定位） */
function findOffenders(needle: string): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (readFileSync(file, 'utf8').includes(needle)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  return offenders;
}

describe('storage.session accessLevel 守卫', () => {
  it('每个运行时目录都真实贡献源码文件（防止清单被改动后守卫空跑）', () => {
    for (const { dir, sources } of scannedByDir) {
      expect(sources.length, `目录 ${dir}/ 未扫描到任何运行时源文件，扫描清单或目录约定已变化`).toBeGreaterThan(0);
    }
    // 实测 194 个文件；数量级下跌说明目录约定被改动，测试本身需要更新
    expect(files.length).toBeGreaterThan(150);
  });

  it('全仓运行时源码不含 setAccessLevel 调用', () => {
    expect(findOffenders('setAccessLevel')).toEqual([]);
  });

  it('全仓运行时源码不含 TRUSTED_AND_UNTRUSTED 字符串', () => {
    expect(findOffenders('TRUSTED_AND_UNTRUSTED')).toEqual([]);
  });
});
