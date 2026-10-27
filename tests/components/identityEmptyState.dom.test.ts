/** @vitest-environment jsdom */

/**
 * 身份库「真实空态」的出路守卫
 *
 * 缺陷本体：`identity.empty` 的文案让用户「点击下方『添加个人信息』」，但该分支只渲染了一个
 * `el-empty`，唯一的添加按钮在顶部工具栏；页面侧右键 / 气泡第一次把新用户送进空库时，
 * 这句话会直接落空。守卫拆成两件事：
 * 1. 空态分支内必须真的有 `identity.add` 按钮，且复用工具栏同一条 `$emit('add')`（不建第二套添加流程）；
 * 2. 空态要说清「这个库能存什么」，新用户才不至于把空白弹窗当成坏了。
 *
 * 与 `identityCardActions.dom.test.ts` 同一套取数方式：读真实 SFC 模板片段，不重写组件逻辑，
 * 避免测试与实现漂移。
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = readFileSync(path.join(ROOT, 'components/options/IdentityVaultDialog.vue'), 'utf8');

/** 取真实空态分支（`rows.length === 0`）的模板原文，止于「无匹配」分支之前 */
function emptyStateBlock(): string {
  const { descriptor, errors } = parse(SOURCE, { filename: 'IdentityVaultDialog.vue' });
  expect(errors).toEqual([]);
  const template = descriptor.template?.content ?? '';
  const start = template.indexOf('v-if="!loading && rows.length === 0"');
  const end = template.indexOf('v-else-if="!loading && filteredRows.length === 0"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return template.slice(start, end);
}

describe('身份库真实空态', () => {
  it('文案指向的添加按钮确实存在于同一分支，并复用工具栏的 add 事件', () => {
    const block = emptyStateBlock();
    expect(block).toContain("t('identity.empty')");
    expect(block).toContain("t('identity.add')");
    expect(block).toContain("$emit('add')");
  });

  it('空态说明库里能存什么，且只有一条添加出口', () => {
    const block = emptyStateBlock();
    expect(block).toContain("t('identity.emptyHint')");
    expect([...block.matchAll(/\$emit\('add'\)/g)]).toHaveLength(1);
  });
});
