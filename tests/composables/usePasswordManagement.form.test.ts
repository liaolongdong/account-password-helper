/**
 * 密码表单字段所有权测试（usePasswordManagement）
 *
 * 锁定 `passwordForm.tag` 的单一写入通道契约：tag 只能经 `tagArray` computed setter 写入，
 * 弹窗回写补丁（`applyPasswordFormPatch`）必须忽略补丁中携带的 tag。
 *
 * 同时锁定校验层不越权约束 tag：`passwordFormRules` 不含 tag 规则（详见
 * `tests/utils/formValidators.test.ts` 的回归背景）。
 *
 * 回归背景：添加/编辑弹窗内的 localForm 是 props 的镜像副本，其 tag 只在整表替换
 * （新增 / 编辑 / 重置）时同步，用户选完标签后即变为陈旧值。修复前弹窗把整份 localForm
 * （含陈旧 tag）回传，父级用内联 `Object.assign(passwordForm, $event)` 直接覆盖，
 * 导致「选完标签再输入备注 → 标签被清空」（新增态）与「标签被静默回滚」（编辑态）。
 *
 * 弹窗侧的「击键 → emit → 回写」链路无法在本仓测试环境自动化（`environment: 'node'`
 * 且未安装 @vitejs/plugin-vue），故此处覆盖状态所有者一侧的边界契约。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { stringifyTags } from '@/utils/tagUtils';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

describe('usePasswordManagement 密码表单字段所有权', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(() => {
    // composable 内部用 onScopeDispose 清理搜索防抖定时器，需在 effect scope 中构造
    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
  });

  afterEach(() => {
    scope.stop();
  });

  it('回写补丁携带陈旧 tag 时不覆盖已选标签，其余字段照常写入', () => {
    mgmt.tagArray.value = ['工作', '生活'];
    expect(mgmt.passwordForm.value.tag).toBe('工作,生活');

    // 复刻弹窗修复前的回写载荷：localForm.tag 仍是选择标签之前的空串
    mgmt.applyPasswordFormPatch({ username: 'alice', password: '', url: '', tag: '', remark: 'x', totp: '' });

    expect(mgmt.tagArray.value).toEqual(['工作', '生活']);
    expect(mgmt.passwordForm.value.tag).toBe('工作,生活');
    expect(mgmt.passwordForm.value.username).toBe('alice');
    expect(mgmt.passwordForm.value.remark).toBe('x');
  });

  it('编辑态改动标签后回写其他字段不回滚标签', () => {
    mgmt.editPassword(makePasswordEntry({ id: 'e1', username: 'bob', tag: '工作,生活' }));
    expect(mgmt.tagArray.value).toEqual(['工作', '生活']);

    // 用户删掉一个标签（走 tagArray 通道），随后输入备注：镜像里的 tag 仍是打开弹窗时的旧值
    mgmt.tagArray.value = ['工作'];
    mgmt.applyPasswordFormPatch({
      username: 'bob',
      password: 'p',
      url: '',
      tag: '工作,生活',
      remark: '备注',
      totp: '',
    });

    expect(mgmt.tagArray.value).toEqual(['工作']);
    expect(mgmt.passwordForm.value.remark).toBe('备注');
  });

  it('tagArray setter 去空白、过滤空项并去重', () => {
    mgmt.tagArray.value = [' 工作 ', '', '工作'];

    expect(mgmt.passwordForm.value.tag).toBe('工作');
  });

  it('补丁缺字段时不把 undefined 写进表单', () => {
    mgmt.openPasswordDialog('example.com');
    mgmt.applyPasswordFormPatch({ username: 'carol' });

    expect(mgmt.passwordForm.value).toEqual({
      username: 'carol',
      password: '',
      url: 'example.com',
      tag: '',
      remark: '',
      totp: '',
    });
  });

  it('整表替换路径（新增 / 重置）仍会清空 tag', () => {
    mgmt.tagArray.value = ['工作'];
    mgmt.openPasswordDialog('example.com');
    expect(mgmt.passwordForm.value).toEqual({
      username: '',
      password: '',
      url: 'example.com',
      tag: '',
      remark: '',
      totp: '',
    });

    mgmt.tagArray.value = ['生活'];
    mgmt.resetPasswordForm();
    expect(mgmt.passwordForm.value.tag).toBe('');
    expect(mgmt.isEditingPassword.value).toBe(false);
    expect(mgmt.editingPasswordId.value).toBe('');
  });

  it('校验规则不约束 tag：合法长标签组合不被 validate() 阻断', () => {
    // 修复前的最小复现：2 个 25 字符标签（均未超单标签上限 30）序列化后 51 字符，
    // 超过工厂里 tag 规则的 max: 50，使该条目在编辑态无法保存任何改动
    mgmt.tagArray.value = ['A'.repeat(25), 'B'.repeat(25)];
    const longTag = mgmt.passwordForm.value.tag;
    expect(longTag).toBe(stringifyTags(['A'.repeat(25), 'B'.repeat(25)]));
    expect(longTag).toHaveLength(51);

    // editPassword 整表替换 passwordForm ref，弹窗 props watcher 随之同步；
    // 规则里没有 tag，EP 的 form.validate() 便不会拒绝这类合法条目
    mgmt.editPassword(makePasswordEntry({ id: 'e2', username: 'bob', tag: longTag }));
    expect(mgmt.passwordForm.value.tag).toBe(longTag);
    expect(mgmt.passwordFormRules.value).not.toHaveProperty('tag');
  });

  it('passwordFormRules 保留其余字段规则并追加 totp', () => {
    expect(Object.keys(mgmt.passwordFormRules.value).sort()).toEqual(['password', 'remark', 'totp', 'url', 'username']);
  });
});
