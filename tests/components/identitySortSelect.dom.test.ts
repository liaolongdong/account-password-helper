/** @vitest-environment jsdom */

/**
 * 结构守卫：`el-tooltip` 包住 `el-select` 之后，select 仍然是工具栏 flex 容器的**直接子元素**。
 *
 * 为什么值得钉一条测试：`.identity-toolbar__sort { flex: none; width: 104px }` 是实测下限——
 * 760px 弹窗（内容区 728px）里，类别按钮 242/289 + 档位 104 + 添加按钮 136/125 + 3×12 间距，
 * 剩下的才是搜索框（zh 210px / en 174px）。Element Plus 的 tooltip 靠 OnlyChild 把触发元素
 * 本身当作 popper anchor、不插包装节点；一旦它哪天改成包一层 `<span>`，多出来的匿名 flex item
 * 会把这 104px 预算吃掉，而搜索框是纯受害者——属于「只有布局退化、功能测试抓不到」的那类回归。
 *
 * 这里只断言 DOM 结构，不断言 EP 内部实现：升级 EP 时若这条变红，去看的是包装节点，不是档位逻辑。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { ElOption, ElSelect, ElTooltip } from 'element-plus';

/** jsdom 缺位的 ResizeObserver（EP select 测宽用），给一个不回调的空桩即可 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});

// 项目未开 unstubGlobals 自动清理，桩必须显式回收：本文件后续一旦加用例，
// 没有这一条就会静默继承上一轮的 ResizeObserver 桩（与 identityCrud.sortMode.test.ts 同一约定）。
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('身份信息库工具栏的排序档位', () => {
  it('tooltip 不插入包装节点，select 保持为 flex 容器的唯一直接子元素', async () => {
    const host = document.createElement('div');
    host.className = 'identity-toolbar';
    document.body.appendChild(host);

    const app = createApp({
      render: () =>
        h(
          ElTooltip,
          { content: '排序方式', placement: 'top' },
          {
            default: () =>
              h(
                ElSelect,
                { modelValue: 'updated', size: 'small', 'aria-label': '排序方式' },
                { default: () => [h(ElOption, { value: 'updated', label: '最近修改' })] },
              ),
          },
        ),
    });
    app.mount(host);
    await nextTick();

    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild?.classList.contains('el-select')).toBe(true);

    app.unmount();
    host.remove();
  });
});
