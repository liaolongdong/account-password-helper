/**
 * 快捷键命令清单一致性测试
 *
 * `utils/shortcutCommands.ts` 的 SHORTCUT_COMMANDS 与 `wxt.config.ts` 的
 * manifest.commands 是同一份事实的两处表达：前者供 UI 展示与兜底，后者才是
 * 真正向浏览器注册按键的地方。两者一旦漂移，用户会看到「界面写着 Ctrl+Shift+K，
 * 按下却毫无反应」。本测试直接读取 wxt.config.ts 源码文本做静态比对，
 * 无需执行配置模块即可拦住这类回归。
 *
 * 平台兜底分支（default / mac）同样纳入校验：Chrome 按平台择一注册，展示层
 * 若只跟随 default，macOS 用户会在未绑定行看到与 manifest 声明不符的 Ctrl 组合键。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { SHORTCUT_COMMANDS, resolveDefaultShortcut } from '@/utils/shortcutCommands';

const ROOT = path.resolve(__dirname, '../..');

const WXT_CONFIG_SOURCE = readFileSync(path.join(ROOT, 'wxt.config.ts'), 'utf-8');

/** manifest.commands 配置块（从 `commands: {` 起截到文件尾，命令键均为 6 空格缩进） */
const COMMANDS_BLOCK = WXT_CONFIG_SOURCE.slice(WXT_CONFIG_SOURCE.indexOf('commands: {'));

/**
 * 取出指定命令的 manifest 配置块
 *
 * 锚定 6 空格缩进的命令键与同缩进的收尾 `},`，使惰性匹配不会跨到下一个命令，
 * 从而「命令缺少 suggested_key」不会被误判为取到了后一个命令的按键。
 */
function readCommandChunk(commandId: string): string | undefined {
  return COMMANDS_BLOCK.match(new RegExp(`^ {6}${commandId}: \\{[\\s\\S]*?\\n {6}\\},`, 'm'))?.[0];
}

/** 解析命令块内 suggested_key.default 的字面值 */
function readSuggestedDefault(commandId: string): string | undefined {
  const chunk = readCommandChunk(commandId);
  if (!chunk) return undefined;
  return /suggested_key:\s*\{[\s\S]*?default:\s*'([^']+)'/.exec(chunk)?.[1];
}

/** 解析命令块内 suggested_key.mac 的字面值 */
function readSuggestedMac(commandId: string): string | undefined {
  const chunk = readCommandChunk(commandId);
  if (!chunk) return undefined;
  return /suggested_key:\s*\{[\s\S]*?mac:\s*'([^']+)'/.exec(chunk)?.[1];
}

describe('SHORTCUT_COMMANDS 与 manifest.commands 一致性', () => {
  it('manifest.commands 声明存在（防止定位锚点失效使其余断言空转）', () => {
    expect(WXT_CONFIG_SOURCE.indexOf('commands: {')).toBeGreaterThan(-1);
  });

  it('命令标识无重复', () => {
    const ids = SHORTCUT_COMMANDS.map(meta => meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个命令标识都在 manifest.commands 中注册', () => {
    for (const { id } of SHORTCUT_COMMANDS) {
      expect(readCommandChunk(id), `manifest.commands 缺少命令「${id}」`).toBeDefined();
    }
  });

  it('defaultShortcut 与 manifest 的 suggested_key.default 完全一致', () => {
    for (const { id, defaultShortcut } of SHORTCUT_COMMANDS) {
      expect(readSuggestedDefault(id), `命令「${id}」的建议按键与 manifest 不一致`).toBe(defaultShortcut);
    }
  });

  it('defaultShortcutMac 与 manifest 的 suggested_key.mac 完全一致', () => {
    for (const { id, defaultShortcutMac } of SHORTCUT_COMMANDS) {
      expect(readSuggestedMac(id), `命令「${id}」的 mac 建议按键与 manifest 不一致`).toBe(defaultShortcutMac);
    }
  });

  it('suggested_key.mac 分支数量与清单长度一致（防止漏声明导致 mac 兜底失真）', () => {
    const macKeyCount = [...COMMANDS_BLOCK.matchAll(/mac:\s*'/g)].length;
    expect(macKeyCount).toBe(SHORTCUT_COMMANDS.length);
  });

  it('两个平台分支的兜底值互不相同（防止 mac 值被误写成 default 副本）', () => {
    for (const { id, defaultShortcut, defaultShortcutMac } of SHORTCUT_COMMANDS) {
      expect(defaultShortcutMac, `命令「${id}」的 mac 兜底值与 default 重复`).not.toBe(defaultShortcut);
    }
  });

  it('manifest.commands 未出现清单之外的命令', () => {
    const manifestIds = [...COMMANDS_BLOCK.matchAll(/^ {6}([a-z_]+): \{$/gm)].map(match => match[1]);
    expect(manifestIds).toEqual(SHORTCUT_COMMANDS.map(meta => meta.id));
  });

  it('suggested_key 数量与清单长度一致（防止无默认按键的命令悄悄混入）', () => {
    const suggestedKeyCount = [...COMMANDS_BLOCK.matchAll(/suggested_key:/g)].length;
    expect(suggestedKeyCount).toBe(SHORTCUT_COMMANDS.length);
  });
});

/**
 * resolveDefaultShortcut 的平台分支
 *
 * 显式传入 isMac 驱动两个分支，不依赖宿主机 navigator：Node 会把
 * `navigator.platform` 继承为运行机器的值（在 macOS 上为 `MacIntel`），
 * 若走默认参数，本组断言将随 CI 宿主平台翻转。
 */
describe('resolveDefaultShortcut 平台分支', () => {
  it('非 Apple 平台返回 suggested_key.default 原值', () => {
    for (const meta of SHORTCUT_COMMANDS) {
      expect(resolveDefaultShortcut(meta, false)).toBe(meta.defaultShortcut);
    }
  });

  it('Apple 平台返回 suggested_key.mac 原值', () => {
    for (const meta of SHORTCUT_COMMANDS) {
      expect(resolveDefaultShortcut(meta, true)).toBe(meta.defaultShortcutMac);
    }
  });

  it('返回的是未格式化的 manifest 原值（格式化职责归调用方的 formatShortcut）', () => {
    const meta = SHORTCUT_COMMANDS[0];

    expect(resolveDefaultShortcut(meta, false)).toContain('+');
    expect(resolveDefaultShortcut(meta, true)).toContain('+');
  });
});
