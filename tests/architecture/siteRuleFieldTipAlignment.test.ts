/**
 * 站点规则弹窗「字段提示语」的左边界与纵向节奏守卫
 *
 * 弹窗的 `el-form` 是 `label-position="top"`，只有「影子 DOM 穿透」这一行为了紧凑改成
 * `label-position="left"`。Element Plus 随之把这一行的 `el-form-item` 变成 flex 行，
 * 内容列只剩「弹窗宽度 − 标签宽度」（实测 684 − 181.41），于是写在插槽里的提示语整块右移
 * 181.41px —— 用户看到的「这一条提示语没有左对齐」不是设计，是 0470e87 把 checkbox 换成
 * switch 时顺带引入的样式副作用。
 *
 * 修法是把提示语移出 form-item 做兄弟块，代价是这一行的下边距没人扛了（原本由
 * `el-form-item` 的 18px 提供），所以配了一对互相抵消的声明：`.penetrate-item` 归零、
 * `.penetrate-tip` 接管 18px。这三件事任何一件单独被改动都不会报错，也都不在
 * `typecheck` / `lint` / Stylelint 的可见范围内（它们看不见 `.vue` 的模板与声明取值），
 * 故在此钉死：
 * 1. 带 `label-position="left"` 的 form-item **内部**不得出现提示语；
 * 2. 提示语必须是该 form-item 紧随其后的兄弟块，且该 form-item 带 `.penetrate-item` 类；
 * 3. 边距补偿成对存在：提示语贴开关 4px、行末留白 18px（等于 EP 的 form-item 默认边距）。
 *
 * 口径边界：本文件钉的是**源码结构与声明值**，左边界真正相等这一事实由真机量得
 * （2026-10-14，Chrome for Testing 153，三条提示语 `getBoundingClientRect().left` 均为 296）。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const SRC_PATH = 'components/options/SiteRulesDialog.vue';

/** Element Plus `.el-form-item` 的默认下边距（2.14.4 实测值），行末留白的基准 */
const EP_FORM_ITEM_MARGIN_BOTTOM = 18;

/** 提示语贴住上方控件所需的 `margin-top` */
const TIP_MARGIN_TOP = 4;

/** 取 `<template>` 段；失配即抛，不让结构守卫静默空跑 */
const templateOf = (src: string): string => {
  const block = src.match(/<template>([\s\S]*)<\/template>/);
  if (!block) throw new Error('找不到 `<template>` 块');
  return block[1];
};

/** 取 `<style scoped>` 段并摘掉注释（本文件的注释里就写着 4px / 18px，按属性定位会命中注释） */
const scopedCssOf = (src: string): string => {
  const block = src.match(/<style scoped>([\s\S]*?)<\/style>/);
  if (!block) throw new Error('找不到 `<style scoped>` 块');
  return block[1].replace(/\/\*[\s\S]*?\*\//g, '');
};

/** 某个选择器规则体里的一个声明值；规则或声明缺失即抛 */
const declOf = (css: string, selector: string, prop: string): string => {
  const rule = new RegExp(`(^|\\s)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!rule) throw new Error(`没有 \`${selector}\` 这条规则`);
  const value = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+?)\\s*(?:;|$)`).exec(rule[2]);
  if (!value) throw new Error(`\`${selector}\` 里没有 \`${prop}\` 声明`);
  return value[1];
};

/** 所有 `label-position="left"` 的 form-item 的内部内容（本弹窗当前只有一行，但按多行写） */
const leftLabelItemBodies = (tpl: string): string[] =>
  [...tpl.matchAll(/<el-form-item[^>]*label-position="left"[^>]*>([\s\S]*?)<\/el-form-item>/g)].map(m => m[1]);

/** 提示语作为左标签行紧随兄弟块的存在性（中间只允许夹解释性注释，不允许夹别的元素） */
const tipIsSiblingAfterItem = (tpl: string): boolean =>
  /<\/el-form-item>\s*(?:<!--[\s\S]*?-->\s*)?<div\s+class="field-tip penetrate-tip"/.test(tpl);

describe('站点规则弹窗的字段提示语对齐', () => {
  const src = readSource(SRC_PATH);
  const css = scopedCssOf(src);
  const tpl = templateOf(src);

  it('左标签行的插槽里没有提示语，且提示语是其紧随其后的兄弟块', () => {
    const bodies = leftLabelItemBodies(tpl);
    // 空跑防护：这一行若被改名或去掉 label-position，判据会退化成恒真
    expect(bodies.length, '没有定位到任何 `label-position="left"` 的 form-item').toBeGreaterThan(0);
    for (const [i, body] of bodies.entries()) {
      expect(body, `第 ${i + 1} 个左标签行内部出现了 field-tip：提示语会被标签挤离左边界`).not.toContain('field-tip');
    }
    expect(tipIsSiblingAfterItem(tpl), '提示语不是左标签行紧随其后的兄弟块，左边界无法与 top 标签字段对齐').toBe(true);

    // 牙齿：把提示语搬回插槽内（本缺陷的原始形态）——必须是「搬」而不是「复制」，
    // 否则外面的兄弟块还在，兄弟判据会以真绿冒充假绿
    const regressed = tpl
      .replace(/\s*<div class="field-tip penetrate-tip">[\s\S]*?<\/div>/, '')
      .replace(
        /(<el-switch v-model="formData\.penetrateShadow" \/>)/,
        '$1\n          <div class="field-tip penetrate-tip">x</div>',
      );
    expect(regressed, '变异串没有真的把提示语搬进行内').toContain('<div class="field-tip penetrate-tip">x</div>');
    expect(leftLabelItemBodies(regressed)[0], '搬回插槽内之后，内部含 field-tip 没有被识别').toContain('field-tip');
    expect(tipIsSiblingAfterItem(regressed), '搬回插槽内之后，兄弟块判据仍然通过').toBe(false);
  });

  it('边距补偿成对存在：贴开关 4px、行末留白 18px', () => {
    const itemMargin = Number.parseFloat(declOf(css, '.penetrate-item', 'margin-bottom'));
    const tipMargin = Number.parseFloat(declOf(css, '.penetrate-tip', 'margin-bottom'));
    const tipTop = Number.parseFloat(declOf(css, '.field-tip', 'margin-top'));
    expect(itemMargin, '左标签行的下边距没有归零，提示语与开关之间会多出 18px').toBe(0);
    expect(tipTop, '提示语贴控件的间距不是 4px').toBe(TIP_MARGIN_TOP);
    expect(tipMargin, '提示语没有接管行末留白，表单底部会少 18px').toBe(EP_FORM_ITEM_MARGIN_BOTTOM);
    // 提示语上方的实际间距 = 行下边距 + 提示语 margin-top，两者必须只留后者
    expect(itemMargin + tipTop, '提示语与开关之间的实际间距不等于 4px').toBe(TIP_MARGIN_TOP);

    // 牙齿：只归零行边距、不接管提示语的 18px（或反之），行末留白都会算错
    const droppedCompensation = css.replace(/(\.penetrate-tip\s*\{[^}]*?)margin-bottom:[^;]+;/, '$1');
    expect(
      (() => {
        try {
          return Number.parseFloat(declOf(droppedCompensation, '.penetrate-tip', 'margin-bottom'));
        } catch {
          return Number.NaN;
        }
      })(),
      '删掉 .penetrate-tip 的 margin-bottom 后判据没有变红',
    ).not.toBe(EP_FORM_ITEM_MARGIN_BOTTOM);
  });

  it('扫描本身有效：目标结构在源文件里真的存在', () => {
    expect(src, '左标签行没有带 .penetrate-item 类，边距接管的选择器会落空').toContain('class="penetrate-item"');
    expect(declOf(css, '.penetrate-item', 'margin-bottom')).toBe('0');
    expect(declOf(css, '.penetrate-tip', 'margin-bottom')).toBe(`${EP_FORM_ITEM_MARGIN_BOTTOM}px`);
    expect(declOf(css, '.field-tip', 'margin-top')).toBe(`${TIP_MARGIN_TOP}px`);
  });
});
