/**
 * 详情抽屉的密码行不许对空口令说「这里有一把密码」
 *
 * 缺陷本体：密码行无条件渲染 `'*'.repeat(8)` 掩码，并挂上「显示 / 复制」两个动作
 * （`components/options/PasswordDetailDrawer.vue:79-98`）。库里存在空口令条目（快速添加今天就
 * 允许，手机号 + 短信码登录自动保存后更是常态），于是这条目点开显示 8 个点——用户以为有密码，
 * 点眼睛点开是空白，点复制复制到空串。
 *
 * 取数方式与 `tests/components/identityEmptyState.dom.test.ts` 一致：读真实 SFC 模板片段。
 * Element Plus 抽屉没有挂载测试装置（`@vue/test-utils` 未接入本仓），而 `.vue` 的这段结构
 * 既过不了 typecheck 也过不了 lint 的眼睛——只有把模板结构钉住，才不会哪天又被改回固定掩码。
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = readFileSync(path.join(ROOT, 'components/options/PasswordDetailDrawer.vue'), 'utf8');

/** 取真实密码条目（`common.password` 那一条 descriptions-item）的模板原文 */
function passwordItemBlock(): string {
  const { descriptor, errors } = parse(SOURCE, { filename: 'PasswordDetailDrawer.vue' });
  expect(errors).toEqual([]);
  const template = descriptor.template?.content ?? '';
  const start = template.indexOf(':label="t(\'common.password\')"');
  const end = template.indexOf(':label="t(\'common.url\')"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return template.slice(start, end);
}

describe('详情抽屉的空口令条目', () => {
  it('有口令才渲染掩码与动作；空口令走本地化空态，不给一排假的点', () => {
    const block = passwordItemBlock();
    expect(block).toContain('v-if="!entry.password"');
    expect(block).toContain("t('options.detail.noPassword')");
    expect(block).toContain('v-else');
  });

  it('显示与复制两个动作挂在「有口令」那一支里，空口令条目上不存在', () => {
    const block = passwordItemBlock();
    const elseBranch = block.slice(block.indexOf('v-else'));
    expect(elseBranch).toContain("'*'.repeat(8)");
    expect(elseBranch).toContain('copySecret(entry.password)');
    // 假掩码不许留在 v-else 之前（那等于无条件渲染）
    expect(block.slice(0, block.indexOf('v-else')).indexOf("'*'.repeat(8)")).toBe(-1);
  });
});
