/**
 * 工具栏会话状态图标的资源与接线守卫（M-5）
 *
 * 单位测试（`tests/background/actionIconSessionState.test.ts`）管的是「切档算得对不对」，
 * 这里管三件它看不见的事——那三件都只会在**真实产物**上出错，且出错时单测照样全绿：
 *
 * ① **产物真的存在**。`chrome.action.setIcon` 拿到不存在的路径时只在控制台报一次错，
 *    工具栏外观静默不变，用户看到的仍是默认档（钥匙）。所以模块里出现的每一个
 *    `icon/…` 路径都必须能在 `public/` 下对上文件，且两档逐尺寸字节不同——
 *    否则「一眼看出锁没锁」这条承诺是空的。
 * ② **锁定态走子目录**。WXT 只把 `public/icon/{16,32,48,96,128}.png` 认作 manifest 与
 *    `action.default_icon`；锁定态一旦落进 `public/icon/` 根目录，manifest 图标就有两份
 *    候选，安装后首帧显示哪一档不再由我们决定。
 * ③ **接线点还在**。整个状态机只有两个入口：SW 启动时按会话材料对齐一次，以及
 *    `storage.onChanged` 的会话键分支按「材料出现 / 被清除」切档。后者是唯一的收口点——
 *    手动锁定、到期、重启重锁、闲置、设置与验证主密码、换钥最终都汇到这两个键上，
 *    漏掉这一句就等于全部锁定入口都不再改图标，而单测对此一无所知。
 *
 * 另加一条设计前提：图标不碰角标通道（✓ / ! / new 是「刚刚发生了什么」，归 quickFillHandler 与
 * 更新提醒管），两通道互不覆写。
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');
const bytes = (relative: string) => readFileSync(path.join(ROOT, relative));
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12);

/**
 * 取出某个导出函数的函数体
 *
 * 接线点必须按「挂在哪条链上」判定，不能只按「文件里出现过这个调用」判定：
 * `refreshActionIcon` 挂在 `initBackgroundConfig`（仅 onInstalled）也能通过全文包含断言，
 * 但浏览器重启后的那次对齐就永远不会发生。
 */
const functionBody = (source: string, name: string): string => {
  const start = source.indexOf(`export function ${name}`);
  expect(start, `源文件里找不到 export function ${name}`).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const nextExport = rest.indexOf('\nexport ', 1);
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
};

/** 模块源与它引用的图标路径 */
const MODULE_SRC = read('entrypoints/background/actionIcon.ts');
const SERVICES_SRC = read('entrypoints/background/backgroundServices.ts');
const SCRIPT_SRC = read('scripts/generate-icons.mjs');

/** 模块里出现过的全部 `icon/…` 路径（去重后逐个验存在） */
const REFERENCED_ICON_PATHS = [...new Set(MODULE_SRC.match(/'icon\/[^']+'/g)?.map(item => item.slice(1, -1)) ?? [])];

/** manifest 图标必须继续落在 `public/icon/` 根目录的这五档（WXT 自动识别的名单） */
const MANIFEST_SIZES = [16, 32, 48, 96, 128];

describe('工具栏状态图标的资源面', () => {
  it('模块引用的每个 icon 路径都有对应产物', () => {
    // 正向对照：判据本身要能抓到东西，否则「全部存在」是空集恒真
    expect(REFERENCED_ICON_PATHS.length, '没从模块里解析出任何 icon 路径，判据失效').toBeGreaterThanOrEqual(8);

    for (const iconPath of REFERENCED_ICON_PATHS) {
      expect(existsSync(path.join(ROOT, 'public', iconPath)), `public/${iconPath} 不存在，setIcon 会静默失败`).toBe(
        true,
      );
    }
  });

  it('锁定态产物在 locked 子目录下，逐尺寸与解锁态不同', () => {
    for (const size of MANIFEST_SIZES) {
      const unlocked = bytes(`public/icon/${size}.png`);
      const locked = bytes(`public/icon/locked/${size}.png`);
      expect(digest(locked), `${size}px：锁定态与解锁态产物字节相同，图标看不出状态`).not.toBe(digest(unlocked));
    }
  });

  it('锁定态矢量源存在，且由图标脚本一并生成', () => {
    expect(existsSync(path.join(ROOT, 'assets/icons/icon-locked.svg')), '缺少锁定态矢量源').toBe(true);
    // 脚本必须把两档都列进 ICON_SETS：漏一档的话 `icons:build` 只会静默少生成一套产物，
    // 而 setIcon 要到用户第一次锁定那天才会发现
    expect(SCRIPT_SRC).toContain("'assets/icons/icon-locked.svg'");
    expect(SCRIPT_SRC).toContain("'public/icon/locked'");
  });

  it('manifest 图标目录只放那五档，锁定态整体待在子目录里', () => {
    for (const size of MANIFEST_SIZES) {
      expect(existsSync(path.join(ROOT, `public/icon/${size}.png`)), `manifest 图标 ${size}.png 丢失`).toBe(true);
    }
    // WXT 按文件名挑 manifest 与 action.default_icon 图标：根目录里多出任何兄弟文件，
    // 「安装后首帧显示哪一档」就不再完全由我们决定，所以这里钉死目录清单本身。
    // 唯一的豁免是 .DS_Store——它在 .gitignore 第 41 行、全仓各目录都有，干净检出量不到、
    // 本地 macOS 却人人都有，把它算进清单只会让这条守卫在无关改动上无故变红。
    const rootEntries = readdirSync(path.join(ROOT, 'public/icon'))
      .filter(entry => entry !== '.DS_Store')
      .sort();
    expect(rootEntries, 'public/icon 根目录混进了非 manifest 图标产物').toEqual([
      '128.png',
      '16.png',
      '32.png',
      '48.png',
      '96.png',
      'locked',
    ]);
  });
});

describe('工具栏状态图标的接线点', () => {
  it('SW 启动时按会话材料对齐一次图标', () => {
    // 必须挂在 setupBackgroundServices（每次 SW 启动都执行）而不是 initBackgroundConfig（仅 onInstalled）：
    // 后者会让「浏览器重启后仍是锁定态」这条路径拿不到修正
    expect(functionBody(SERVICES_SRC, 'setupBackgroundServices')).toContain('void refreshActionIcon();');
    expect(
      functionBody(SERVICES_SRC, 'initBackgroundConfig'),
      'refreshActionIcon 被挂到了仅 onInstalled 执行的 initBackgroundConfig 上',
    ).not.toContain('refreshActionIcon');
  });

  it('会话键变更按「材料出现 / 被清除」切档，且判定复用既有的 sessionRemoved', () => {
    expect(SERVICES_SRC).toContain("setActionIconState(sessionRemoved ? 'locked' : 'unlocked');");
    // 牙齿：把三元两侧换位（锁定显示成钥匙）也必须被这条抓到——判据钉的是整句，不是函数名
    const swapped = SERVICES_SRC.replace(
      "setActionIconState(sessionRemoved ? 'locked' : 'unlocked');",
      "setActionIconState(sessionRemoved ? 'unlocked' : 'locked');",
    );
    expect(swapped, '换位后的串与原判据无法区分，这条判据没有牙').not.toContain(
      "setActionIconState(sessionRemoved ? 'locked' : 'unlocked');",
    );
  });

  it('图标模块不越界到角标通道', () => {
    for (const api of ['setBadgeText', 'setBadgeBackgroundColor', 'setBadgeTextColor']) {
      expect(MODULE_SRC, `actionIcon 不应调用 ${api}：角标是另一条通道`).not.toContain(api);
    }
    // 正向对照：角标通道确实归 quickFillHandler 管
    expect(read('entrypoints/background/quickFillHandler.ts')).toContain('setBadgeText');
  });
});
