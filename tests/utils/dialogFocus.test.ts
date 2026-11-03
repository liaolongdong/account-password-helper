/** @vitest-environment jsdom */

/**
 * 弹窗自动聚焦时序的行为测试
 *
 * 用真实的 ElDialog + ElInput 复刻「打开后聚焦」的接线：focus-trap 会在微任务里
 * 把焦点移到 `.el-dialog` 容器，`focusAfterDialogOpen` 必须晚于它执行，最终焦点
 * 才落在输入框上。SFC 无法在 Vitest 管线中 import（见 richText.dom.test.ts 的口径），
 * 因此这里挂载的是同一份 render 结构与工具函数。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, watch, type App, type Ref } from 'vue';
import { ElDialog, ElInput } from 'element-plus';
import type { InputInstance } from 'element-plus';
import { focusAfterDialogOpen } from '@/utils/dialogFocus';

let app: App | undefined;

/** 与 MasterPasswordVerifyDialog 相同的打开时机：visible 变化后聚焦输入框 */
function mountDialog(): { visible: Ref<boolean>; inputRef: Ref<InputInstance | undefined> } {
  const visible = ref(false);
  const inputRef = ref<InputInstance>();

  app = createApp({
    setup() {
      watch(visible, value => {
        if (value) focusAfterDialogOpen(() => inputRef.value?.focus());
      });
      return () =>
        h(
          ElDialog,
          {
            modelValue: visible.value,
            'onUpdate:modelValue': (value: boolean) => (visible.value = value),
          },
          { default: () => h(ElInput, { ref: inputRef, type: 'password' }) },
        );
    },
  });
  app.mount(document.body.appendChild(document.createElement('div')));
  return { visible, inputRef };
}

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

describe('弹窗打开后的自动聚焦', () => {
  it('焦点最终落在输入框，而不是 .el-dialog 容器', async () => {
    const { visible } = mountDialog();
    await nextTick();

    visible.value = true;
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 20));

    const input = document.querySelector('.el-dialog .el-input__inner');
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });
});
