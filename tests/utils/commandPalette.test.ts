import { describe, it, expect } from 'vitest';
import { filterActions, nextActiveIndex, clampActiveIndex, type CommandAction } from '@/utils/commandPalette';

/** 构造最小动作（run 用空函数占位，纯过滤/索引逻辑不触发它） */
function action(
  id: string,
  label: string,
  keywords: string[] = [],
  group: CommandAction['group'] = 'data',
): CommandAction {
  return { id, group, label, keywords, run: () => {} };
}

describe('filterActions', () => {
  const actions: CommandAction[] = [
    action('add', '添加密码', ['add', 'new', 'tianjiami']),
    action('export', '导出数据', ['export', 'csv', 'daochu']),
    action('trash', '回收站', ['trash', 'delete', 'huishouzhan']),
  ];

  it('空关键词（含纯空白）返回全部，保持原顺序', () => {
    expect(filterActions(actions, '')).toEqual(actions);
    expect(filterActions(actions, '   ')).toEqual(actions);
  });

  it('命中展示名子串（大小写不敏感）', () => {
    expect(filterActions(actions, '回收').map(a => a.id)).toEqual(['trash']);
  });

  it('命中英文检索别名', () => {
    expect(filterActions(actions, 'csv').map(a => a.id)).toEqual(['export']);
  });

  it('命中中文拼音/首字母别名（子串口径）', () => {
    expect(filterActions(actions, 'daochu').map(a => a.id)).toEqual(['export']);
  });

  it('多命中按原顺序返回', () => {
    const multi = [...actions, action('exportjson', '导出JSON', ['export', 'json'])];
    expect(filterActions(multi, 'export').map(a => a.id)).toEqual(['export', 'exportjson']);
  });

  it('无命中返回空数组', () => {
    expect(filterActions(actions, 'zzz')).toEqual([]);
  });
});

describe('nextActiveIndex（循环导航）', () => {
  it('下移一格', () => {
    expect(nextActiveIndex(0, 5, 1)).toBe(1);
    expect(nextActiveIndex(3, 5, 1)).toBe(4);
  });

  it('末位下移回到首位', () => {
    expect(nextActiveIndex(4, 5, 1)).toBe(0);
  });

  it('首位上移回到末位', () => {
    expect(nextActiveIndex(0, 5, -1)).toBe(4);
  });

  it('空列表恒为 0', () => {
    expect(nextActiveIndex(0, 0, 1)).toBe(0);
    expect(nextActiveIndex(3, 0, -1)).toBe(0);
  });
});

describe('clampActiveIndex（结果变短兜底）', () => {
  it('越界收敛到末位', () => {
    expect(clampActiveIndex(9, 5)).toBe(4);
  });

  it('负值收敛到首位', () => {
    expect(clampActiveIndex(-2, 5)).toBe(0);
  });

  it('范围内原样返回', () => {
    expect(clampActiveIndex(2, 5)).toBe(2);
  });

  it('空列表返回 0', () => {
    expect(clampActiveIndex(3, 0)).toBe(0);
  });
});
