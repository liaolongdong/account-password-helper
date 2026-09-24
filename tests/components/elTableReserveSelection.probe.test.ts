/** @vitest-environment jsdom */

/**
 * 探针测试（一次性，非回归资产）：实测 element-plus 2.14.4 `el-table` 在
 * `row-key` + `type="selection"` + `reserve-selection` 下，`data` 被整体换成
 * 「分页切片」时选择集的真实行为，为 Options 页 PasswordTable 接入真分页做决策依据。
 *
 * 关注点（对应 `node_modules/.../element-plus/es/components/table/src/`）：
 * - `store/index.mjs:35-37` `setData`：`reserveSelection` 为真时只 `assertRowKey()`，
 *   既不调用 `clearSelection()` 也不调用 `cleanSelection()`。
 * - `store/watcher.mjs:293-321` `_toggleAllSelection`：只遍历 `data.value`（当前页）。
 * - `store/watcher.mjs:219-226` `clearSelection`：无条件把 `selection` 置空。
 * - `store/watcher.mjs:275-292` + `util.mjs:137-167` `toggleRowStatus`：有 rowKey 时按 key 查找下标。
 * - `store/watcher.mjs:111-114` `isSelected`：有 rowKey 时走 `selectedMap`（按 key），故渲染态跟随 key。
 *
 * 不挂载真实 PasswordTable（依赖 i18n / store / 图标等大量上下文），这里用最小 el-table
 * 复现同一套 store 语义；断言值全部来自实测，不是推测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, toRaw, type ComponentPublicInstance } from 'vue';
import { ElTable, ElTableColumn } from 'element-plus';

/** 探针用的极简行数据，`id` 即 row-key */
interface Row {
  id: string;
  name: string;
}

/** 挂载结果：暴露表格实例、事件流水与换 data 的唯一入口 */
interface Probe {
  table: any;
  /** 每次 `selection-change` 触发时记录的 id 列表（父组件真正看到的口径） */
  events: string[][];
  setData(rows: Row[]): Promise<void>;
  destroy(): void;
}

/** 等待 watcher + 布局 debounce + toggleAllSelection 的 10ms debounce 全部落地 */
const settle = async (ms = 40) => {
  await nextTick();
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, ms));
  await nextTick();
};

/** 最小 el-table：row-key + 多选列（reserveSelection 可配） */
const mountProbe = async (rows: Row[], reserve: boolean): Promise<Probe> => {
  const events: string[][] = [];
  const data = ref<Row[]>([...rows]);
  let table: any = null;

  const app = createApp({
    render() {
      return h(
        ElTable,
        {
          ref: (el: Element | ComponentPublicInstance | null) => {
            table = el;
          },
          data: data.value,
          rowKey: 'id',
          onSelectionChange: (selection: Row[]) => {
            events.push(selection.map(row => row.id));
          },
        },
        () => [
          h(ElTableColumn, { type: 'selection', reserveSelection: reserve }),
          h(ElTableColumn, { prop: 'name', label: 'name' }),
        ],
      );
    },
  });

  const host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  await settle();

  return {
    get table() {
      return table;
    },
    events,
    async setData(rows) {
      // 与真实场景一致：每次给一个「新数组实例」，触发 style-helper 的 props.data watcher
      data.value = [...rows];
      await settle();
    },
    destroy() {
      app.unmount();
      host.remove();
    },
  };
};

/** 读取 store 内部 selection（等价于 getSelectionRows 的原始对象数组） */
const selectedIds = (probe: Probe): string[] => probe.table.getSelectionRows().map((row: Row) => row.id);
const selectionRows = (probe: Probe): Row[] => probe.table.getSelectionRows();

/** 父组件收到的最后一次 `selection-change` 载荷（本仓库 TS lib 目标不含 `Array.prototype.at`） */
const last = (events: string[][]): string[] => events[events.length - 1] ?? [];

const makeRows = (): Row[] => [1, 2, 3, 4, 5].map(i => ({ id: `r${i}`, name: `name-${i}` }));

/** 全选列复选框（表头）→ 走真实交互路径，而非直接调 store */
const clickHeaderCheckbox = async (probe: Probe) => {
  const el = probe.table.$el.querySelector('.el-table__header-wrapper th.el-table-column--selection .cell label');
  expect(el).toBeTruthy();
  (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle(60);
};

describe('el-table reserve-selection 分页行为探针', () => {
  let probe: Probe | null = null;

  beforeEach(() => {
    vi.useRealTimers();
    // jsdom 未实现 ResizeObserver，layout-observer 依赖它
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    probe?.destroy();
    probe = null;
    document.body.innerHTML = '';
  });

  it('a. 换页（data 切片不含旧选中行）：selection 保留，且不触发 selection-change', async () => {
    const rows = makeRows();
    probe = await mountProbe(rows, true);

    probe.table.toggleRowSelection(rows[0], true);
    await settle();
    probe.table.toggleRowSelection(rows[1], true);
    await settle();

    expect(probe.events).toEqual([['r1'], ['r1', 'r2']]);

    // 切到第 2 页：r1/r2 不在 data 中
    await probe.setData([rows[2], rows[3]]);

    expect(probe.events, 'data 变化后不应再派发 selection-change').toEqual([['r1'], ['r1', 'r2']]);
    expect(selectedIds(probe)).toEqual(['r1', 'r2']);
    expect(selectedIds(probe)).toEqual(last(probe.events));

    // 切回第 1 页：按 key 恢复渲染为勾选（同一批对象），依旧不派发事件
    await probe.setData([rows[0], rows[1]]);
    expect(selectedIds(probe)).toEqual(['r1', 'r2']);
    expect(probe.events).toEqual([['r1'], ['r1', 'r2']]);
    expect(probe.table.$el.querySelectorAll('.el-table__body-wrapper .el-checkbox.is-checked').length).toBe(2);
  });

  it('b. clearSelection()：连同保留行一并清空并派发一次 []', async () => {
    const rows = makeRows();
    probe = await mountProbe(rows, true);

    probe.table.toggleRowSelection(rows[0], true);
    probe.table.toggleRowSelection(rows[1], true);
    await settle();
    await probe.setData([rows[2]]);

    const before = probe.events.length;
    probe.table.clearSelection();
    await settle();

    expect(selectedIds(probe)).toEqual([]);
    expect(probe.events.length).toBe(before + 1);
    expect(last(probe.events)).toEqual([]);

    // 清空后换页不会再「复活」旧选择
    await probe.setData([rows[3], rows[4]]);
    expect(selectedIds(probe)).toEqual([]);
    expect(probe.events.length).toBe(before + 1);
  });

  it('c. 表头全选只作用于当前 data，与保留行做并集；再点一次只取消当前页', async () => {
    const rows = makeRows();
    probe = await mountProbe(rows, true);

    probe.table.toggleRowSelection(rows[0], true);
    await settle();
    await probe.setData([rows[1], rows[2]]);
    expect(selectedIds(probe)).toEqual(['r1']);

    await clickHeaderCheckbox(probe);
    expect(selectedIds(probe), '表头全选应只补当前页 r2/r3，保留 r1').toEqual(['r1', 'r2', 'r3']);
    expect(last(probe.events)).toEqual(['r1', 'r2', 'r3']);

    await clickHeaderCheckbox(probe);
    expect(selectedIds(probe), '再次点击只取消当前页，保留跨页的 r1').toEqual(['r1']);
    expect(last(probe.events)).toEqual(['r1']);
  });

  it('c2. 表头半选态：select-on-indeterminate 默认 true → 点击即全选当前页', async () => {
    const rows = makeRows();
    probe = await mountProbe(rows, true);
    probe.table.toggleRowSelection(rows[0], true);
    await settle();
    // 当前页存在未勾选项，表头应处于 indeterminate
    await probe.setData([rows[0], rows[1]]);
    expect(probe.table.store.states.isAllSelected.value).toBe(false);
    await clickHeaderCheckbox(probe);
    expect(selectedIds(probe)).toEqual(['r1', 'r2']);
  });

  it('d. 行对象身份变化：原地 Object.assign 存活；换成同 id 新对象则保留旧对象引用', async () => {
    const rows = makeRows();
    probe = await mountProbe(rows, true);
    const r1 = rows[0];
    probe.table.toggleRowSelection(r1, true);
    await settle();

    // 我们的代码用 Object.assign 原地更新行 → 同一对象，保留项自然反映新值
    Object.assign(r1, { name: 'in-place-updated' });
    await probe.setData([rows[2]]);
    await probe.setData([r1, rows[3]]);
    expect(selectionRows(probe)[0].name).toBe('in-place-updated');
    // 注意：selection 存在 `ref([])` 里，读出来的是 r1 的响应式代理而非裸对象本身，
    // 但对同一 target 代理恒定，因此 toRaw 后仍是原地更新的那个对象
    expect(selectionRows(probe)[0] === r1, '裸对象身份不相等（代理包装）').toBe(false);
    expect(toRaw(selectionRows(probe)[0])).toBe(r1);
    expect(selectionRows(probe)[0]).toBe(selectionRows(probe)[0]);

    // 换成「同 id 的新对象」（如从 storage 重新读出并重建对象）
    const r1Copy = { id: 'r1', name: 'fresh-from-storage' };
    await probe.setData([r1Copy]);

    expect(selectionRows(probe).length, '不应因为同 id 新对象而重复累积').toBe(1);
    expect(toRaw(selectionRows(probe)[0]), '保留的仍是旧对象引用，不是页面里的新对象').toBe(r1);
    expect(selectionRows(probe)[0].name).toBe('in-place-updated');
    expect(probe.table.store.isSelected(r1Copy), '渲染/勾选判定按 key，新对象视为已选中').toBe(true);

    // 取消勾选按 key 命中，能摘掉旧对象
    probe.table.toggleRowSelection(r1Copy, false);
    await settle();
    expect(selectedIds(probe)).toEqual([]);
  });

  it('d2. 选中行被彻底删除（永不再出现在 data 中）：保留项不会被回收', async () => {
    const rows = makeRows();
    probe = await mountProbe(rows, true);
    probe.table.toggleRowSelection(rows[0], true);
    probe.table.toggleRowSelection(rows[1], true);
    await settle();

    // r2 从数据源消失，反复换页都不再出现
    await probe.setData([rows[2]]);
    await probe.setData([rows[3]]);
    await probe.setData([rows[4]]);
    await probe.setData([]);

    expect(selectedIds(probe), 'reserve-selection 下 cleanSelection 不被调用，已删行滞留').toEqual(['r1', 'r2']);
    expect(probe.events, '全程未派发 selection-change').toEqual([['r1'], ['r1', 'r2']]);
  });

  it('e. 对照组：不开 reserve-selection，换页数组即清空选择', async () => {
    const rows = makeRows();
    probe = await mountProbe(rows, false);
    probe.table.toggleRowSelection(rows[0], true);
    await settle();
    expect(last(probe.events)).toEqual(['r1']);

    await probe.setData([rows[1], rows[2]]);

    expect(last(probe.events), 'dataInstanceChanged → clearSelection()').toEqual([]);
    expect(selectedIds(probe)).toEqual([]);
  });
});
