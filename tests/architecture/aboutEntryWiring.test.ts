/**
 * 「关于」抽屉入口的接线守卫
 *
 * 「关于」抽屉是管理页唯一的集中出口（版本、数据存放口径、许可证全文、Issues、
 * 隐私政策、产品说明站），而入口只有一处：头部菜单里那一项。三段接线
 * （HeaderBar 触发 → App.vue 监听并挂载 → 抽屉自身渲染）里删掉任意一段，用户失去的是
 * 整个出口，界面上却不会报任何错——本仓对同型的静默断链已有机械守卫
 * （`siteFillEntryOverrideWiring`、`siteFilterWiring`），故此处同样做扫描而不是指望 review。
 *
 * 各条分别守住一个真实漂移方向：
 * 1. 「帮助」下拉里必须有 `about` 那一项，分派函数把它透成 `openAbout`，且 `defineEmits` 里有这
 *    一位（缺声明时事件不透出）；入口自 2026-10-22 起从常驻按钮改为下拉项，两段都在本文件里；
 * 2. App.vue 必须同时具备监听、挂载与 `v-model` 三处，缺任一处抽屉永不出现；
 * 3. 抽屉必须是异步组件——它进首屏 chunk 就是在给管理页 `preRowMs` 加重量；
 * 4. 外链必须逐条取自 `utils/urls.ts` 常量并带 `rel="noopener noreferrer"`：地址一旦散回
 *    组件内部，就会与 `REPO_GITHUB_URL` 各说一套（`repoUrlLiteralGuard` 守的是另一半）。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const HEADER_BAR = 'components/options/HeaderBar.vue';
const APP = 'entrypoints/options/App.vue';
const DRAWER = 'components/options/AboutDrawer.vue';
const URLS = 'utils/urls.ts';

/** 抽屉里用到的 URL 常量名（含三元分支里的两个隐私政策地址，只按 `href:` 前缀会漏掉它们） */
const URL_CONST_NAME = /\b[A-Z][A-Z0-9_]{2,}URL[A-Z0-9_]*\b/g;

describe('「关于」抽屉的入口接线', () => {
  const header = readSource(HEADER_BAR);
  const app = readSource(APP);
  const drawer = readSource(DRAWER);

  it('扫描面读到了被测源文件（守卫不得静默空跑）', () => {
    for (const file of [HEADER_BAR, APP, DRAWER, URLS]) {
      expect(readSource(file).length).toBeGreaterThan(0);
    }
  });

  it('「帮助」下拉里有 about 项，且分派透出 openAbout', () => {
    // 菜单项本身：少了它，下拉里就没有这一行
    expect(header).toMatch(/command="about"/);
    // 命令 → 事件的分派：这两句缺任意一句，点「关于」都不再有反应，而界面上不会报错
    expect(header).toMatch(/case 'about':\s*emit\('openAbout'\);/);
    // 没有这一行时模板照旧点得动，但事件不会向上透出：抽屉永远不出现
    expect(header).toMatch(/openAbout:\s*\[\s*\]/);
  });

  it('App.vue 同时接住事件、挂载抽屉并绑定 v-model', () => {
    expect(app).toContain('@open-about="showAboutDrawer = true"');
    expect(app).toContain('<AboutDrawer');
    expect(app).toContain('v-model="showAboutDrawer"');
  });

  it('抽屉是异步组件，不进管理页首屏 chunk', () => {
    expect(app).toContain("defineAsyncComponent(() => import('@/components/options/AboutDrawer.vue'))");
  });

  it('出口链接只认 utils/urls 常量，且新标签页链接带 rel 隔离', () => {
    const names = [...new Set(drawer.match(URL_CONST_NAME) ?? [])];
    // 正向对照：提取口径失配时名字清单为空，下面几条会一起假绿
    expect(names.length).toBeGreaterThanOrEqual(6);
    const urlsSource = readSource(URLS);
    for (const name of names) {
      expect(urlsSource, `${name} 不是 utils/urls.ts 导出的常量`).toContain(`export const ${name} =`);
    }
    // 许可证全文是 GPL 要求用户能方便读到的那一出口，缺它等于只说了个名字
    expect(drawer).toMatch(/href:\s*REPO_LICENSE_URL/);
    expect(drawer).toContain('target="_blank"');
    expect(drawer).toContain('rel="noopener noreferrer"');
    // 字面量地址一旦回到组件里，就与 utils/urls 分家（仓库地址与隐私政策都因此漂移过）
    expect(drawer).not.toMatch(/href="https?:\/\//);
    expect(drawer).not.toMatch(/href:\s*['"]https?:\/\//);
  });
});
