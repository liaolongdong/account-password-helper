/**
 * 站点规则新增覆盖项（悬浮按钮显隐 / 跨子域匹配档位）的解析回归测试
 *
 * 两个解析器与 `resolveFillEntry` 同口径：站点**替换**全局、缺省跟随全局、
 * storage 脏值按未设置处理。必须钉住的边界：
 * 1. 旧形状规则（只有选择器 / 穿透 / 填充档位）不得顺带改变按钮显隐或匹配档位——
 *    否则升级后存量规则会静默推翻用户的全局偏好；
 * 2. 显式 `false` / `'off'` 是有效覆盖而不是「未设置」：全局开着的按钮要能被站点关掉，
 *    全局放宽的档位要能被站点收回精确隔离；
 * 3. 显式 `true` 同样是有效覆盖：全局隐藏时可为个别站点单独唤出按钮，
 *    不能把 `true` 当默认值丢弃（penetrateShadow 的「只存 false」口径在这里不适用）；
 * 4. 非法值（字符串 / null / 对象 / 未知档位）一律跟随全局，绝不参与判定。
 */
import { describe, expect, it } from 'vitest';
import { resolveDomainMatchMode, type DomainMatchMode } from '@/utils/domain';
import { resolveFloatingButtonVisible, type SiteRule } from '@/utils/storage/siteRules';

const MODES: DomainMatchMode[] = ['off', 'wildcard', 'sameMainDomain'];

describe('resolveFloatingButtonVisible（站点替换全局显隐）', () => {
  it('缺省跟随全局：无规则 / 空规则 / 旧形状规则都不改变全局值', () => {
    const legacyRule: SiteRule = {
      domain: 'example.com',
      customSelectors: { username: '#user' },
      penetrateShadow: false,
      fillEntry: 'inline',
    };
    for (const global of [true, false]) {
      expect(resolveFloatingButtonVisible(global, undefined)).toBe(global);
      expect(resolveFloatingButtonVisible(global, null)).toBe(global);
      expect(resolveFloatingButtonVisible(global, {})).toBe(global);
      expect(resolveFloatingButtonVisible(global, legacyRule)).toBe(global);
    }
  });

  it('显式 false 是有效覆盖：全局显示时站点可单独隐藏', () => {
    expect(resolveFloatingButtonVisible(true, { floatingButton: false })).toBe(false);
  });

  it('显式 true 是有效覆盖：全局隐藏时站点可单独显示', () => {
    expect(resolveFloatingButtonVisible(false, { floatingButton: true })).toBe(true);
  });

  it('脏值按未设置处理：非布尔一律跟随全局', () => {
    for (const dirty of ['false', 'true', 0, 1, null, {}, []]) {
      expect(resolveFloatingButtonVisible(true, { floatingButton: dirty })).toBe(true);
      expect(resolveFloatingButtonVisible(false, { floatingButton: dirty })).toBe(false);
    }
  });
});

describe('resolveDomainMatchMode（站点替换全局档位）', () => {
  it('缺省跟随全局：无规则 / 空规则 / 旧形状规则都不改变全局档位', () => {
    const legacyRule: SiteRule = {
      domain: 'example.com',
      customSelectors: { password: '#pass' },
      fillEntry: 'manual',
    };
    for (const global of MODES) {
      expect(resolveDomainMatchMode(global, undefined)).toBe(global);
      expect(resolveDomainMatchMode(global, null)).toBe(global);
      expect(resolveDomainMatchMode(global, {})).toBe(global);
      expect(resolveDomainMatchMode(global, legacyRule)).toBe(global);
    }
  });

  it('三档都能覆盖全局，且是替换而非取更保守：宽全局可被站点收回 off', () => {
    for (const global of MODES) {
      for (const override of MODES) {
        expect(resolveDomainMatchMode(global, { domainMatchMode: override })).toBe(override);
      }
    }
  });

  it('脏值按未设置处理：未知档位 / 非字符串一律跟随全局', () => {
    for (const dirty of ['OFF', 'same-main-domain', '', true, 0, null, {}, []]) {
      expect(resolveDomainMatchMode('off', { domainMatchMode: dirty })).toBe('off');
      expect(resolveDomainMatchMode('sameMainDomain', { domainMatchMode: dirty })).toBe('sameMainDomain');
    }
  });
});
