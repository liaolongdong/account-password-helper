/**
 * 「查看详情」的图标语义守卫（眼睛只归密码显隐）
 *
 * 用户侧的歧义是这一颗按钮存在的全部理由：密码列表每行原本有两只眼睛（查看详情 + 显示密码），
 * 而眼睛在本产品里恒为「显示 / 隐藏机密」那一件事（同列的密码显隐、详情抽屉、身份库卡片、
 * 注入到页面密码框的切换按钮都如此）。改成 `InfoFilled` 之后，这件事只剩一条代码可表达，
 * 而 e2e 是按 `aria-label` 定位按钮的（图标怎么换都照样绿），`tsc --noEmit` 又看不见
 * `.vue` 的 `<script setup>` —— 一次「顺手统一图标」就能把歧义请回来，且没有任何门禁会响。
 *
 * 因此这里钉三层：
 * 1. 查看详情那颗按钮的图标是 `InfoFilled`，不是 `View` / `Hide`；
 * 2. 本组件里 `View` / `Hide` 只出现在密码显隐那一处三元表达式上（眼睛的归属唯一）；
 * 3. 页内帮助（`help.gd.8`）中英文都把它描述成「圆圈 i / circled i」——
 *    文案与代码是同一个决定的两面，任一侧单独漂移就该红。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const TABLE_SRC = read('components/options/PasswordTable.vue');
const HELP_ZH = JSON.parse(read('utils/i18n/locales/zh-CN/help.json')) as Record<string, string>;
const HELP_EN = JSON.parse(read('utils/i18n/locales/en/help.json')) as Record<string, string>;

/** 密码显隐与详情两个动作的 `aria-label` 表达式（模板里的行内绑定名） */
const VIEW_DETAIL_LABEL = ':aria-label="rowLabels.viewDetail"';
const TOGGLE_PASSWORD_LABEL = ':aria-label="row.showPassword ? rowLabels.hidePassword : rowLabels.showPassword"';

/**
 * 取出包含某个 `aria-label` 的那一整个 `<el-button>` 标签
 *
 * prettier 的 `singleAttributePerLine` 让每个属性独占一行，所以按「向前找最近的
 * `<el-button`、向后找最近的 `/>`」切片即可精确圈定这颗按钮，不必匹配整行的属性顺序。
 */
function buttonBlock(source: string, labelAttr: string): string {
  const labelAt = source.indexOf(labelAttr);
  expect(labelAt, `模板里找不到 ${labelAttr}：按钮的定位属性变了，守卫要跟着改`).toBeGreaterThan(-1);
  expect(source.lastIndexOf(labelAttr), `${labelAttr} 出现多处，切片不再唯一`).toBe(labelAt);
  const start = source.lastIndexOf('<el-button', labelAt);
  expect(start, `${labelAttr} 不在 el-button 内`).toBeGreaterThan(-1);
  const end = source.indexOf('/>', labelAt);
  expect(end, `${labelAttr} 所在的 el-button 未闭合`).toBeGreaterThan(labelAt);
  return source.slice(start, end);
}

describe('查看详情按钮的图标语义', () => {
  it('查看详情用圆圈 i，不是眼睛', () => {
    const block = buttonBlock(TABLE_SRC, VIEW_DETAIL_LABEL);
    expect(block, '查看详情的图标不再是 InfoFilled（本轮去眼睛化的决定被回退）').toMatch(/:icon="InfoFilled"/);
    expect(block, '查看详情又用上了眼睛：同一行两只眼睛，用户分不清哪只负责展开明文').not.toMatch(
      /:icon=".*\b(View|Hide)\b/,
    );
    // 牙齿：把它换回眼睛，上面两条必须分别抓到
    const reverted = block.replace(':icon="InfoFilled"', ':icon="View"');
    expect(/:icon="InfoFilled"/.test(reverted), '图标判据没有牙齿').toBe(false);
    expect(/:icon=".*\b(View|Hide)\b/.test(reverted), '「不是眼睛」判据没有牙齿').toBe(true);
  });

  it('眼睛在本组件只归密码显隐一处', () => {
    const eyeBindings = [...TABLE_SRC.matchAll(/:icon="([^"]*)"/g)]
      .map(m => m[1])
      .filter(value => /\b(View|Hide)\b/.test(value));
    expect(eyeBindings, '眼睛出现在第二颗按钮上：View/Hide 不再是密码显隐的专用语义').toEqual([
      'row.showPassword ? Hide : View',
    ]);
    // 归属那一颗按钮必须还是密码列，而不是随便哪个带 aria-label 的按钮
    expect(buttonBlock(TABLE_SRC, TOGGLE_PASSWORD_LABEL), '密码显隐按钮不再挂 View/Hide').toMatch(
      /:icon="row\.showPassword \? Hide : View"/,
    );
    // 牙齿：把详情的图标并进这处三元，眼睛就会同时出现在两颗按钮上
    expect(
      [...TABLE_SRC.replace(':icon="InfoFilled"', ':icon="View"').matchAll(/:icon="([^"]*)"/g)]
        .map(m => m[1])
        .filter(value => /\b(View|Hide)\b/.test(value)),
      '眼睛计数的判据没有牙齿',
    ).toHaveLength(2);
  });

  it('页内帮助的中英文都描述成圆圈 i', () => {
    for (const [lang, text] of [
      ['zh', HELP_ZH['help.gd.8']],
      ['en', HELP_EN['help.gd.8']],
    ] as const) {
      expect(text, `${lang} 的 help.gd.8 缺键`).toBeTruthy();
      expect(
        /图标是圆圈里的 i|circled-i icon/.test(text),
        `${lang} 的 help.gd.8 还在描述别的图标：文案与代码已经漂移`,
      ).toBe(true);
      expect(/图标是文档|document icon/.test(text), `${lang} 的 help.gd.8 还写着「文档」：那是被否决的候选`).toBe(
        false,
      );
    }
  });
});
