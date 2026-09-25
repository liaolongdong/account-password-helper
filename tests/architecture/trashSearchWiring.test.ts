/**
 * 回收站检索与解密的接线守卫
 *
 * 回收站弹窗的关键词检索看起来只是「加一个输入框」，但它站在三条既有契约的交点上，
 * 每一条都能被一次顺手改动悄悄拆掉（按本仓惯例用源码扫描钉住，见 `vaultPageSizeWiring.test.ts`）：
 *
 * 1. **检索口径单一真源**：过滤必须走 `utils/keywordMatch.filterByKeyword` + 密码表那一份
 *    `matchesKeyword`。组件里自己写一遍 `includes` / `toLowerCase`，就会出现「密码表搜得到、
 *    回收站搜不到」的静默分歧，字段清单与拼音口径也会各说一套。
 * 2. **分页复位信号含关键词**：换关键词是一次查看口径变化，继续停在第 7 页只会读到空白；
 *    漏掉这一项，用户读到的是「搜索没结果」而不是「你在那一页」。
 * 3. **整库解密走受限并发**：`getTrashEntries` 的倒序只有配上「全量解密」才可检索——
 *    没解密的字段搜不到，所以不能退化成只解当前页；而串行 `for … await` 的耗时随条目数
 *    线性累加（口径见 `utils/concurrency.ts` 与 `docs/PERF_ISSUE89_DATA_LAYER_EVALUATION.md` 3.3）。
 *
 * 另附三条外围：打开弹窗必须清掉上一次的检索词（否则这次打开只显示一小撮旧结果）、
 * 锁定那一屏不得参与检索（占位符与密文会搜出无意义命中）、`password` 字段永不解密
 * （回收站与安全模型的既有边界），以及组件引用的 `options.trash.*` key 在中英文语言包都在。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const TRASH_SRC = read('components/options/TrashDialog.vue');
const MANAGER_SRC = read('composables/usePasswordManagement.ts');

/** 剔掉注释行，避免顺序断言读的是散文（同 vaultPageSizeWiring 的处理） */
const stripComments = (src: string): string =>
  src
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');

describe('回收站关键词检索接线', () => {
  it('过滤走单一真源的 filterByKeyword，且注入密码表那一份匹配器', () => {
    expect(TRASH_SRC).toMatch(/import\s*\{\s*filterByKeyword[^}]*\}\s*from '@\/utils\/keywordMatch'/);
    expect(TRASH_SRC).toMatch(/import\s*\{\s*matchesKeyword\s*\}\s*from '@\/utils\/searchMatch'/);
    expect(TRASH_SRC, '检索未经过 filterByKeyword，口径会与密码表/侧边栏分叉').toMatch(
      /filterByKeyword\(\s*trashList\.value,\s*activeKeyword\.value,\s*matchesKeyword\s*\)/,
    );
  });

  it('组件内不自己实现第二套关键词匹配', () => {
    expect(TRASH_SRC, '组件内出现自制匹配：字段清单与拼音口径会与单一真源分叉').not.toMatch(
      /\.\s*filter\s*\([\s\S]{0,120}?(toLowerCase|includes|indexOf)\s*\(/,
    );
  });

  it('分页数据源是过滤后的列表，复位信号同时含「打开」与生效关键词', () => {
    const paginationCall = TRASH_SRC.match(
      /useVaultListPagination\(\s*\n?\s*(\w+),\s*\n?\s*computed\(\(\)\s*=>\s*([\s\S]*?)\),?\s*\)/,
    );
    expect(paginationCall, '未找到分页装配语句').toBeTruthy();
    expect(paginationCall![1], '分页数据源必须是过滤后的列表，而不是原始 trashList').toBe('displayEntries');
    expect(paginationCall![2]).toContain('props.modelValue');
    expect(paginationCall![2], '复位信号漏掉生效关键词：换词后仍停在旧页码').toContain('activeKeyword');
  });

  it('输入即时回显、过滤走防抖副本，且定时器随作用域清理', () => {
    expect(TRASH_SRC).toMatch(/v-model="searchKeyword"/);
    expect(TRASH_SRC, '过滤直接吃原始输入值：每击键一次就重排一页').not.toMatch(
      /filterByKeyword\([\s\S]{0,60}?searchKeyword\.value/,
    );
    expect(TRASH_SRC).toMatch(
      /watch\(\s*searchKeyword,\s*value\s*=>\s*\{[\s\S]*?debouncedKeyword\.value = value;?\s*\},?\s*KEYWORD_DEBOUNCE_MS\s*\)/,
    );
    expect(TRASH_SRC).toContain('onScopeDispose(() => clearTimeout(searchDebounceTimer))');
  });

  it('防抖时长只有一处定义，两个分页视图共用同一个常量', () => {
    // 各自抄一份 200，早晚会有一处被"手感更好"的理由改动，于是密码表与回收站对
    // 「跟不跟手」给出两种答案——这正是当初把档位收进单一存储键要防的事。
    const HOOK_SRC = read('utils/keywordMatch.ts');
    expect(HOOK_SRC).toMatch(/export const KEYWORD_DEBOUNCE_MS = 200;/);
    expect(MANAGER_SRC, '密码表的防抖不再走共享常量').toMatch(/KEYWORD_DEBOUNCE_MS/);
    for (const [file, src] of [
      ['components/options/TrashDialog.vue', TRASH_SRC],
      ['composables/usePasswordManagement.ts', MANAGER_SRC],
    ]) {
      expect(src, `${file} 的防抖时长回退成裸字面量`).not.toMatch(/setTimeout\([\s\S]{0,120}?\},\s*200\s*\)/);
    }
  });

  it('弹窗打开时先清空两个关键词副本，再取数', () => {
    const openBranch = TRASH_SRC.match(/if \(visible\) \{([\s\S]*?)\n\s*\}/);
    expect(openBranch, '未找到弹窗打开分支').toBeTruthy();
    const statements = stripComments(openBranch![1]);
    const clearRaw = statements.indexOf("searchKeyword.value = ''");
    const clearDebounced = statements.indexOf("debouncedKeyword.value = ''");
    const loadAt = statements.indexOf('loadTrash()');
    expect(clearRaw, '打开弹窗未清检索词：这次打开会残留上一次的过滤结果').toBeGreaterThanOrEqual(0);
    expect(clearDebounced, '只清了输入框，防抖副本仍会让旧结果闪进第一帧').toBeGreaterThanOrEqual(0);
    expect(clearDebounced, '清理必须早于取数').toBeLessThan(loadAt);
  });

  it('锁定那一屏不参与检索：输入框与其上游关键词一起悬空', () => {
    // 锁定态那一屏是本地化占位文案 + 「•••」+ 原始密文标签，让它参与过滤，
    // 用户输入 `•` 就命中全部行、输入一段 base64 又命中若干条密文。
    expect(TRASH_SRC, '检索框不再受可搜性门控').toMatch(/<el-input\s*\n?\s*v-if="isSearchable"/);
    expect(TRASH_SRC, '生效关键词不再经可搜性收窄').toMatch(
      /const activeKeyword = computed\(\(\) => \(isSearchable\.value \? debouncedKeyword\.value : ''\)\)/,
    );
    // 两个分支各自显式赋值，缺一个就会留下一屏「上一屏的可搜性」
    const assignable = TRASH_SRC.match(/isSearchable\.value = (?:true|false)/g) ?? [];
    expect(assignable, '锁定/解密两条分支不再分别落定可搜性').toHaveLength(2);
    expect(assignable).toContain('isSearchable.value = false');
    expect(assignable).toContain('isSearchable.value = true');
  });

  it('空态与计数读数跟随检索口径，且引用的文案 key 在中英文语言包都在', () => {
    expect(TRASH_SRC, '无匹配时仍显示通用「暂无数据」，用户分不清是空回收站还是搜不到').toMatch(
      /hasKeyword \? t\('options\.trash\.searchNoMatch'\) : t\('common\.noData'\)/,
    );

    const usedKeys = [...TRASH_SRC.matchAll(/t\('(options\.trash\.[\w.]+)'/g)].map(m => m[1]);
    expect(usedKeys.length, '未扫描到回收站文案 key，守卫写法需同步更新').toBeGreaterThan(0);
    for (const locale of ['zh-CN', 'en']) {
      const messages = JSON.parse(read(`utils/i18n/locales/${locale}/options.json`)) as Record<string, string>;
      for (const key of usedKeys) {
        expect(messages[key], `${locale} 语言包缺少 ${key}`).toBeTruthy();
      }
    }
  });
});

describe('回收站解密接线', () => {
  it('整库解密走 mapWithConcurrency，不回退成串行 for…await', () => {
    expect(TRASH_SRC).toMatch(/mapWithConcurrency\(\s*entries\s*,/);
    expect(TRASH_SRC, '串行解密回归：条目数一多就是线性累加的等待').not.toMatch(/for \(const entry of entries\)/);
    expect(TRASH_SRC).toMatch(/import\s*\{[^}]*mapWithConcurrency[^}]*\}\s*from '@\/utils\/concurrency'/);
  });

  it('解密只覆盖展示用的三个字段，password 永不动手', () => {
    // 检索要覆盖全库，最容易顺手做的就是"顺便把密码也解出来"。这条边界与
    // 回收站本身的安全模型同源：口令只在填充时解密，展示路径连读都不读。
    const decryptCalls = [...TRASH_SRC.matchAll(/enc\.decryptData\(\s*entry\.(\w+)/g)].map(m => m[1]);
    expect([...new Set(decryptCalls)].sort(), '回收站解密字段清单漂移（新增字段须先确认安全边界）').toEqual([
      'tag',
      'url',
      'username',
    ]);
  });
});
