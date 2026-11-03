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
import { IN_APP_SHORTCUTS, SHORTCUT_COMMANDS, resolveDefaultShortcut } from '@/utils/shortcutCommands';

const ROOT = path.resolve(__dirname, '../..');

const WXT_CONFIG_SOURCE = readFileSync(path.join(ROOT, 'wxt.config.ts'), 'utf-8');

/** 命令面板的快捷键判定式所在文件：展示值必须与它实际接受的按键同形，否则界面在说谎 */
const PALETTE_SOURCE = readFileSync(path.join(ROOT, 'composables/useCommandPalette.ts'), 'utf-8');

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

/**
 * 应用内快捷键（⌘K 命令面板）清单一致性
 *
 * 这一组与上面那组的**保护对象不同**：manifest 命令要对账的是 `wxt.config.ts`，
 * 而页面级按键没有 manifest 落点，它唯一的事实来源是 `useCommandPalette` 里那句判定式。
 * 于是有两种独有的漂移方向，各自配一把刀：
 * - 有人把 ⌘K 塞进 `SHORTCUT_COMMANDS` → `useShortcuts` 会拿 `getAll()` 给它标状态，
 *   而 `getAll()` 永远读不到页面级按键，用户得到一条**假的「未生效」**；
 * - 有人改了 handler 的字母或修饰键（`k` → `j`、加个 Shift）而忘了改展示值 →
 *   弹窗里印着的键按下去没反应。
 *
 * `labelKey` 走的是 `t(entry.labelKey)` 这种变量 key，`i18nBundles.test.ts` 的静态扫描
 * 口径覆盖不到，因此这里显式查中英两侧都存在，否则运行时只会把 key 本身印给用户。
 */
describe('IN_APP_SHORTCUTS 与页面级监听一致性', () => {
  it('清单非空，且与 manifest 清单互斥（同一条命令不在两处各写一份）', () => {
    const manifestIds = SHORTCUT_COMMANDS.map(meta => meta.id as string);
    const inAppIds = IN_APP_SHORTCUTS.map(entry => entry.id as string);

    expect(inAppIds.length, '应用内快捷键清单为空：⌘K 又会回到无处可查的状态').toBeGreaterThan(0);
    expect(new Set(inAppIds).size, '应用内清单内部有重复 id').toBe(inAppIds.length);
    expect(
      inAppIds.filter(id => manifestIds.includes(id)),
      '同一条命令同时出现在两张清单里',
    ).toEqual([]);
    expect(manifestIds, '⌘K 被塞进了 manifest 清单，getAll() 读不到它，会得到一条假的「未生效」').not.toContain(
      'commandPalette',
    );
  });

  it('展示按键与 useCommandPalette 实际接受的按键同形（改监听不改展示必须判红）', () => {
    const gate = /const isMod = event\.(\w+) \|\| event\.(\w+);[\s\S]*?event\.key\.toLowerCase\(\) === '(\w)'/.exec(
      PALETTE_SOURCE,
    );
    expect(gate, '找不到命令面板的快捷键判定式，本判据会静默空跑').not.toBeNull();
    const [, modA, modB, letter] = gate as unknown as RegExpExecArray;
    expect([modA, modB].sort(), '面板认的修饰键不再是 Ctrl / Cmd 组合').toEqual(['ctrlKey', 'metaKey']);

    const palette = IN_APP_SHORTCUTS.find(entry => entry.id === 'commandPalette');
    expect(palette, '清单里没有命令面板那一条').toBeTruthy();
    expect(palette!.defaultShortcut, '非 Apple 平台展示值与 handler 认的按键不符').toBe(
      `Ctrl+${letter!.toUpperCase()}`,
    );
    expect(palette!.defaultShortcutMac, 'Apple 平台展示值与 handler 认的按键不符').toBe(
      `Command+${letter!.toUpperCase()}`,
    );
    // 展示值不得带 Shift / Alt：`isMod && !shiftKey && !altKey` 是 handler 的硬条件，
    // 多写一个修饰键就是向用户宣布一条按不出来的组合。
    expect(palette!.defaultShortcut).not.toMatch(/shift|alt/i);
    expect(palette!.defaultShortcutMac).not.toMatch(/shift|alt/i);
  });

  it('两个平台分支互不相同，且 resolveDefaultShortcut 对应用内条目同样生效', () => {
    for (const entry of IN_APP_SHORTCUTS) {
      expect(entry.defaultShortcutMac, `${entry.id} 的 mac 值是 default 的副本`).not.toBe(entry.defaultShortcut);
      expect(resolveDefaultShortcut(entry, false)).toBe(entry.defaultShortcut);
      expect(resolveDefaultShortcut(entry, true)).toBe(entry.defaultShortcutMac);
    }
  });

  it('labelKey 在中英两侧 options.json 都存在（变量 key 不在 bundle 守卫的扫描口径内）', () => {
    const zh = JSON.parse(readFileSync(path.join(ROOT, 'utils/i18n/locales/zh-CN/options.json'), 'utf-8'));
    const en = JSON.parse(readFileSync(path.join(ROOT, 'utils/i18n/locales/en/options.json'), 'utf-8'));

    for (const entry of IN_APP_SHORTCUTS) {
      expect(zh[entry.labelKey], `中文语言包缺 ${entry.labelKey}`).toBeTruthy();
      expect(en[entry.labelKey], `英文语言包缺 ${entry.labelKey}`).toBeTruthy();
    }
    for (const key of ['options.shortcuts.inAppTitle', 'options.shortcuts.inAppNote', 'options.shortcuts.inAppScope']) {
      expect(zh[key], `中文语言包缺 ${key}`).toBeTruthy();
      expect(en[key], `英文语言包缺 ${key}`).toBeTruthy();
    }
  });
});
