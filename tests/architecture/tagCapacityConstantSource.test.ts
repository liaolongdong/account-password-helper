/**
 * 标签容量常量（`MAX_TAG_COUNT` / `MAX_TAG_LENGTH`）的单一来源守卫
 *
 * 这两个数字同时被三处消费：新增/编辑表单（`PasswordFormDialog` + `createPasswordFormRules`）、
 * 批量标签弹窗（`BatchTagDialog`）、以及 `usePasswordManagement` 的归一化与超限提示。
 * 它们原先定义在 `composables/usePasswordManagement.ts` 里，等于让「表单容量」这个跨模块契约
 * 寄居在一个 Options 专用 composable 中——表单校验与展示层为了取两个数字，静态依赖整块管理逻辑。
 * 现在与 `PASSWORD_FIELD_LIMITS` 同处 `utils/constants.ts`（该文件本就是字段容量的单一事实来源）。
 *
 * 钉三件事，防止迁移退回去：
 *
 * 1. **定义只有一份**，且在 `utils/constants.ts`；composable 里再出现同名 `export const` 即红。
 * 2. **消费点不从 composable 取**这两个常量（否则第二事实来源重新成立）。
 * 3. **content 侧仍然写死自己的上限**（`utils/capturedTag.ts` 的 `CAPTURED_TAG_MAX_LENGTH`）：
 *    那是「采集通道不承担编辑器校验」的既定取舍，同口径关系由 `tests/utils/capturedTag.test.ts` 钉住，
 *    不许改成跨模块 import 来「消除重复」。
 *
 * 第 2、3 条都配了正向对照，避免抽取失配时守卫静默空跑。
 */
import { describe, it, expect } from 'vitest';
import { MAX_TAG_COUNT, MAX_TAG_LENGTH } from '@/utils/constants';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 扫描范围：运行时代码 + 直接 import 这两个常量的测试 */
const SCANNED_DIRS = ['composables', 'components', 'entrypoints', 'utils', 'tests'];

/** 取所有「一行内既提到标签容量常量、又声明了来源模块」的 import 行 */
function tagConstImports(fromModule: string): string[] {
  const hits: string[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const source = readSource(file);
      for (const line of source.split('\n')) {
        if (/MAX_TAG_(COUNT|LENGTH)/.test(line) && line.includes(`'@/${fromModule}'`)) {
          hits.push(`${file}: ${line.trim()}`);
        }
      }
    }
  }
  return hits;
}

describe('标签容量常量的单一来源', () => {
  it('定义在 utils/constants.ts 且数值口径不变', () => {
    expect(MAX_TAG_COUNT).toBe(5);
    expect(MAX_TAG_LENGTH).toBe(30);

    const source = readSource('utils/constants.ts');
    expect(source).toMatch(/export const MAX_TAG_COUNT = 5;/);
    expect(source).toMatch(/export const MAX_TAG_LENGTH = 30;/);
  });

  it('composable 不再自带第二份定义，改为从 utils/constants 取', () => {
    const source = readSource('composables/usePasswordManagement.ts');
    expect(source, 'composable 里重新出现了同名定义（第二事实来源）').not.toMatch(
      /export const MAX_TAG_(COUNT|LENGTH)/,
    );
    expect(source).toMatch(/import \{ MAX_TAG_COUNT, MAX_TAG_LENGTH \} from '@\/utils\/constants';/);
  });

  it('消费点一律从 utils/constants 取，不从 composable 取', () => {
    const offenders = tagConstImports('composables/usePasswordManagement');
    expect(offenders, `这些行仍从 composable 取标签容量常量：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('正向对照：确实有消费点从 utils/constants 取这两个常量', () => {
    // 上一条是「不应出现」型断言，抽取一旦失配就会静默空跑，所以这里钉住命中数不为 0
    const consumers = tagConstImports('utils/constants');
    expect(
      consumers.length,
      '未扫描到任何从 utils/constants 取标签容量常量的消费点，守卫写法需同步更新',
    ).toBeGreaterThan(0);
    expect(consumers.some(line => line.startsWith('composables/usePasswordManagement.ts:'))).toBe(true);
    expect(consumers.some(line => line.startsWith('components/options/BatchTagDialog.vue:'))).toBe(true);
  });

  it('content 侧的采集上限仍写死，不跨模块 import', () => {
    const source = readSource('utils/capturedTag.ts');
    expect(source).toMatch(/export const CAPTURED_TAG_MAX_LENGTH = 30;/);
    expect(source, '采集侧改为跨模块 import 编辑器上限：首屏闭包与「采集不承担编辑器校验」的取舍被击穿').not.toMatch(
      /from '@\/(utils\/constants|composables\/usePasswordManagement)'/,
    );
    // 两处数值同口径这件事由 tests/utils/capturedTag.test.ts 断言，这里只守住「仍是两个独立来源」
    expect(MAX_TAG_LENGTH).toBe(30);
  });
});
