/**
 * 快速填充入口的派生/回写/站点覆盖回归测试
 *
 * 背景：「填充入口」是设置面板三选一分段控件的对外语义，存储里却是 `fillMode` +
 * `autoShowSidepanel` 两个字段；本次又加入站点规则按档覆盖，于是同一份映射有三处消费方
 * （面板渲染与写回、内容脚本决定弹侧边栏/显示内联图标、站点规则解析）。
 * 必须钉住的边界：
 * 1. 派生与回写互为逆运算且回写结果始终是规范态——面板显示 A、页面行为 B 这类缺陷
 *    正是两处映射不一致造成的；
 * 2. 自相矛盾的存量配置（内联开启却仍 autoShowSidepanel=true）必须收敛到内联，
 *    否则内容脚本会同时走两条互斥分支；
 * 3. 站点档位是「替换」而非「取更保守」，且缺省 = 跟随全局：只配选择器的规则
 *    不得顺手推翻用户的全局偏好；
 * 4. 档位值来自 storage 与导入文件，属不可信输入：非法值按未设置处理，
 *    绝不能让它参与三档判定（任何非 'inline' 的字符串都会落到「自动弹侧边栏」分支）。
 */
import { describe, expect, it } from 'vitest';
import { FILL_ENTRIES, fillEntryToPatch, getFillEntry, isFillEntry, resolveFillEntry } from '@/utils/fillEntry';

/** 三档里任意一档都能构造配置字段 */
const asConfig = (entry: 'sidepanel' | 'inline' | 'manual') => fillEntryToPatch(entry);

describe('getFillEntry（两字段派生一档）', () => {
  it('内联优先：fillMode 为 inline 时不看 autoShowSidepanel', () => {
    expect(getFillEntry({ fillMode: 'inline', autoShowSidepanel: false })).toBe('inline');
    // 存量矛盾组合（历史上两字段可分别落盘）必须收敛到内联，不能同时开两条互斥分支
    expect(getFillEntry({ fillMode: 'inline', autoShowSidepanel: true })).toBe('inline');
  });

  it('非内联时按 autoShowSidepanel 区分「自动弹侧边栏」与「仅手动」', () => {
    expect(getFillEntry({ fillMode: 'sidepanel', autoShowSidepanel: true })).toBe('sidepanel');
    expect(getFillEntry({ fillMode: 'sidepanel', autoShowSidepanel: false })).toBe('manual');
  });
});

describe('fillEntryToPatch（一档回写两字段）', () => {
  it('回写结果都是规范态：每档都显式给出两个字段，不残留矛盾组合', () => {
    for (const entry of FILL_ENTRIES) {
      const patch = asConfig(entry);
      expect(Object.keys(patch).sort()).toEqual(['autoShowSidepanel', 'fillMode']);
    }
  });

  it('与 getFillEntry 互逆（面板显示与页面行为同一口径的根基）', () => {
    for (const entry of FILL_ENTRIES) {
      expect(getFillEntry(asConfig(entry))).toBe(entry);
    }
  });
});

describe('FILL_ENTRIES（展示顺序）', () => {
  it('顺序即分段控件与站点规则下拉的顺序，改顺序等于改 UI', () => {
    expect(FILL_ENTRIES).toEqual(['sidepanel', 'inline', 'manual']);
  });
});

describe('isFillEntry（不可信值收窄）', () => {
  it('只认三档字面量', () => {
    for (const entry of FILL_ENTRIES) {
      expect(isFillEntry(entry)).toBe(true);
    }
  });

  it('拒绝大小写/分隔符变体与非字符串', () => {
    for (const junk of ['Sidepanel', 'side-panel', 'sidepanel ', 'auto', '', true, 1, null, undefined, {}, []]) {
      expect(isFillEntry(junk)).toBe(false);
    }
  });
});

describe('resolveFillEntry（站点规则优先于全局）', () => {
  /**
   * 形状转换：真实调用方传的是整份 `SiteRule`，而解析入口刻意只声明它需要的字段。
   * 测试里直接写对象字面量会吃 TS 的多余属性检查，故用这一层表达「带无关字段的规则」。
   */
  const asRule = (fields: Record<string, unknown>) => fields as { fillEntry?: unknown };

  it('规则显式设档时替换全局，包括把全局的内联换成侧边栏', () => {
    expect(resolveFillEntry(asConfig('inline'), { fillEntry: 'sidepanel' })).toBe('sidepanel');
    expect(resolveFillEntry(asConfig('sidepanel'), { fillEntry: 'manual' })).toBe('manual');
    expect(resolveFillEntry(asConfig('manual'), { fillEntry: 'inline' })).toBe('inline');
  });

  it('规则未声明档位即跟随全局：只配选择器/只关穿透的规则不得顺手改填充入口', () => {
    expect(resolveFillEntry(asConfig('sidepanel'), {})).toBe('sidepanel');
    expect(resolveFillEntry(asConfig('manual'), asRule({ penetrateShadow: false }))).toBe('manual');
    expect(resolveFillEntry(asConfig('inline'), null)).toBe('inline');
    expect(resolveFillEntry(asConfig('inline'), undefined)).toBe('inline');
  });

  it('规则里是非法值时同样回落到全局，而不是参与三档判定', () => {
    // 若不过滤：'sidepanel-auto' 之类会因 !== 'inline' 而落到「自动开侧边栏」分支，
    // 用户在全局选了「仅手动」却被一条坏规则悄悄打开侧边栏。
    for (const junk of ['sidepanel-auto', 'Sidepanel', true, 1, '', {}, []]) {
      expect(resolveFillEntry(asConfig('manual'), { fillEntry: junk })).toBe('manual');
    }
    // 全局是内联时同理，非法值不得把内联降级成侧边栏
    for (const junk of ['sidepanel-auto', null, undefined]) {
      expect(resolveFillEntry(asConfig('inline'), { fillEntry: junk })).toBe('inline');
    }
  });
});
