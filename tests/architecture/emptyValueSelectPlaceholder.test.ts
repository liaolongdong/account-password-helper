/**
 * 「空串也是一个选项」的下拉框必须带 placeholder
 *
 * Element Plus 把空串算作**没有值**：`use-empty-values` 里的
 * `DEFAULT_EMPTY_VALUES = ['', undefined, null]` 让 `hasModelValue` 对 `''` 判 false，
 * 于是选中"无分隔符"之后，`el-select` 走的是 placeholder 分支而不是回显选项文案。
 * 没有 placeholder 时，用户点完"无"看到的是一个**空框**——和"还没选过"一模一样，
 * 他没有任何办法知道自己那次选择生效了。2026-10-26 实测口令生成器的分隔符下拉就是这个状态。
 *
 * 修法取 placeholder 而不是 `:empty-values="[]"`：后者能直接治本（让 `''` 不再是空值），
 * 但那个 prop 在 EP 源码里已标 `@deprecated Removed after 3.0.0`，升级后会静默退回原状。
 *
 * 顺带守住同一份选项表的另一半：`-` `_` `.` 是符号，跨语言同一写法；`space` / `none`
 * 是词，必须有 i18n key 且中英两边都在——之前它们是中文字界面上裸着的英文字面量。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const GENERATOR_UTIL = 'utils/passphraseGenerator.ts';
const POPOVER = 'components/options/PasswordGeneratorPopover.vue';
const ZH = 'utils/i18n/locales/zh-CN/options.json';
const EN = 'utils/i18n/locales/en/options.json';

/** 抠出 `SEPARATOR_OPTIONS = [ ... ]` 里的每一项 */
function separatorEntries(): { raw: string; value: string; labelKey?: string }[] {
  const block = readSource(GENERATOR_UTIL).match(/export const SEPARATOR_OPTIONS = \[([\s\S]*?)\] as const;/)?.[1];
  expect(block, 'SEPARATOR_OPTIONS 的定义形状变了，本判据需要重新对齐').toBeTruthy();
  return [...block!.matchAll(/\{([^}]*)\}/g)].map(match => {
    const valueMatch = /value:\s*'([^']*)'/.exec(match[1]);
    // 空串正是本文件要守的那个取值，不能用真值判断来区分「没写 value」和「value 是空串」
    expect(valueMatch, `选项缺少 value 字段：${match[1].trim()}`).toBeTruthy();
    return { raw: match[1], value: valueMatch![1], labelKey: /labelKey:\s*'([^']+)'/.exec(match[1])?.[1] };
  });
}

/**
 * 能直接当 label 的只有「看得见、且跨语言同形」的符号。
 * 空格看得见吗？看不见——所以它和 `''` 一样必须走文案，否则选项行是一片空白。
 */
const SELF_EVIDENT = ['-', '_', '.'];

describe('空串选项下拉框的可见性', () => {
  const entries = separatorEntries();

  it('选项表里确实存在空串那一项（否则本文件其余判据都是空跑）', () => {
    expect(entries.some(entry => entry.value === '')).toBe(true);
  });

  it('渲染该下拉框的 el-select 带 placeholder，选中「无」时不会退化成空框', () => {
    const source = readSource(POPOVER);
    const select = /<el-select\b[\s\S]*?v-model="passphraseConfig\.separator"[\s\S]*?>/.exec(source)?.[0];
    expect(select, '口令生成器的分隔符下拉框找不到').toBeTruthy();
    expect(select, '空串是 EP 眼里的「没有值」，这个下拉框必须带 placeholder').toMatch(/:placeholder=/);
  });

  it('词类选项走 i18n key，可见符号类选项保留字面量', () => {
    for (const entry of entries) {
      const label = /label:\s*'([^']*)'/.exec(entry.raw)?.[1] ?? '';
      if (SELF_EVIDENT.includes(entry.value)) {
        expect(label, `符号 ${entry.value} 的 label 不该走翻译`).toBeTruthy();
        expect(entry.labelKey, `符号选项不该挂 labelKey：${entry.raw.trim()}`).toBeUndefined();
      } else {
        expect(entry.labelKey, `选项「${label || '(空 label)'}」是词或不可见字符，却没有 labelKey`).toBeTruthy();
      }
    }
  });

  it('每个 labelKey 与 placeholder 用的 key 在中英文包里都存在', () => {
    const keys = entries.map(entry => entry.labelKey).filter(Boolean) as string[];
    const placeholderKey = /:placeholder="t\('([^']+)'\)"/.exec(readSource(POPOVER))?.[1];
    expect(placeholderKey, 'placeholder 必须是静态 i18n key').toBeTruthy();
    const wanted = [...new Set([...keys, placeholderKey!])];
    // 目前是两个 key（空格、无分隔符），placeholder 复用「无分隔符」那一个。
    // 断言下限写 2 而不是拍一个更大的数：这条只是防空跑，真正的覆盖在下面的逐 key 检查。
    expect(wanted.length).toBeGreaterThanOrEqual(2);
    for (const file of [ZH, EN]) {
      const json = JSON.parse(readSource(file)) as Record<string, string>;
      for (const key of wanted) {
        expect(typeof json[key], `${file} 缺 ${key}`).toBe('string');
        expect(json[key]?.trim(), `${file} 的 ${key} 是空串`).not.toBe('');
      }
    }
  });

  it('模板不会把英文字面量 label 直接渲染出去', () => {
    const source = readSource(POPOVER);
    const optionTag = /<el-option\b[\s\S]*?\/>/.exec(source)?.[0];
    expect(optionTag, '分隔符的 el-option 找不到').toBeTruthy();
    expect(optionTag, 'label 必须按 labelKey 是否存在决定走翻译还是字面量').toMatch(
      /:label="'labelKey' in opt \? t\(opt\.labelKey\) : opt\.label"/,
    );
  });
});
