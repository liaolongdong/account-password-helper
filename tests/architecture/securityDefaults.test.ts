/**
 * 安全默认值锚定守卫
 *
 * 这些默认值本身就是对用户的**公开承诺**（README「自动锁定与剪贴板」条目、备份弹窗的风险取向），
 * 但它们分散在存储层默认对象与组件初始值里，没有任何断言：一旦有人改小 PBKDF2 轮数、
 * 把剪贴板自动清除默认关掉、或把备份初始档调回明文，六道门禁全绿也拦不住。
 * 仓库里 §5.2「邮箱备份默认不加密」正是这样长期存在的——所以这里给每条承诺一颗钉子。
 *
 * 两类断言的分工：
 * - 存储层默认值走真实导入（`configManager` 的 `getXxxDefaults()` 不触 IO，纯返回默认对象），
 *   钉住「代码值 == 文档值」；
 * - 组件初始值与密码学参数在 Vue SFC / 字面量里，Node 环境下无法挂载组件，故走源码扫描
 *   （与同目录其他架构守卫一致），并各自配一条「抽取非空」用例，防止正则漂移导致守卫空跑。
 */
import { describe, expect, it } from 'vitest';
import { getDefaultClipboardConfig, getDefaultIdleLockConfig } from '@/utils/storage/configManager';
import { listSourceFiles, readSource, resolveSpecifier } from '../helpers/architectureScan';

/** 运行时代码目录（不含 tests / e2e / product-site 与构建脚本） */
const RUNTIME_DIRS = ['components', 'composables', 'entrypoints', 'utils'] as const;

/**
 * 按「使用的名字」反查它来自哪个具名导入
 *
 * `import { A as B } from 'x'` 里使用名是 B、真实导出是 A，两者都要还给调用方，
 * 否则跟到来源文件却按别名查声明会查不到，把合法写法误报成"值来自别处"。
 */
function namedImport(src: string, usedName: string): { spec: string; original: string } | null {
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of m[1].split(',')) {
      const [original, alias] = part
        .trim()
        .split(/\s+as\s+/)
        .map(s => s.trim());
      if (!original || original === 'type') continue;
      if ((alias || original) === usedName) return { spec: m[2], original };
    }
  }
  return null;
}

describe('安全默认值锚定', () => {
  it('剪贴板：默认开启自动清除且窗口为 30 秒（README:151 承诺）', () => {
    expect(getDefaultClipboardConfig()).toEqual({ autoClear: true, clearAfterSeconds: 30 });
  });

  it('自动锁定：闲置锁定与「浏览器重启锁定」默认关闭（README:151 承诺）', () => {
    // 该默认值是「有效期内关闭浏览器仍保持登录」这一便利承诺的实现前提，
    // 与 WRAP_KEY 落盘（storage.local）配套；单边改成 true 会让侧边栏在重启后
    // 长时间停在锁定卡片，而 README/restartTip 仍承诺自动保持登录 → 文档与实现分叉。
    expect(getDefaultIdleLockConfig()).toEqual({ idleLockMinutes: 0, relockOnBrowserRestart: false });
  });

  it('邮箱备份：初始档是「加密备份」，不加密档必须过显式风险确认', () => {
    const src = readSource('components/options/EmailBackupDialog.vue');

    const initial = /backupType\s*=\s*ref<BackupType>\(\s*(['"])([^'"]+)\1\s*\)/.exec(src);
    expect(initial, '未能在弹窗里定位备份初始档，守卫需随实现方式更新').not.toBeNull();
    expect(initial?.[2]).toBe('encrypted');

    // 明文档的两道提示：选项下方的常驻告警 + 点击「立即备份」时的知情确认
    expect(src).toContain("backupType.value === 'unencrypted'");
    expect(src).toContain('ElMessageBox.confirm');
    expect(src).toContain('options.emailBackup.unencryptedConfirmText');
    expect(src).toContain('options.emailBackup.unencryptedTip');
  });

  it('口令复制：任何写入剪贴板的明文密码都出自 utils/clipboard 的限时清除通道', () => {
    const files = RUNTIME_DIRS.flatMap(dir => listSourceFiles(dir));
    expect(files.length, '运行时代码扫描目录为空，守卫需随目录结构调整').toBeGreaterThan(50);

    const rawWriteFiles = files.filter(file => /navigator\.clipboard\.writeText\s*\(/.test(readSource(file)));
    // 白名单＝「写入的不是长期有效的口令」或「本模块自带同等的快照 + 定时器清除机制」，
    // 每一项都必须在源码里留注释说明理由；新增裸写剪贴板的文件会在这里变红。
    expect(new Set(rawWriteFiles)).toEqual(
      new Set([
        'utils/clipboard.ts', // 限时自动清除通道的实现本身
        'composables/useSidepanelFill.ts', // 侧边栏自带 snapshot + scheduleClearClipboard 的另一套同等机制
        'components/TotpCode.vue', // 30 秒自失效的动态码，刻意不挂清除器
        'entrypoints/content/domUtils.ts', // content script 复制非敏感文本
      ]),
    );

    // 三个明文口令复制入口必须显式走共享通道（漏一个就是「剪贴板里长期留着密码」）
    for (const file of [
      'components/options/PasswordDetailDrawer.vue',
      'components/options/PasswordFormDialog.vue',
      'composables/useIdentityVault.ts',
    ]) {
      expect(readSource(file)).toMatch(/copySecretToClipboard\(/);
    }
  });

  it('密码学参数：全仓 PBKDF2 轮数只有一个取值来源，值恒为 600000 且不来自任何外部入参', () => {
    const files = RUNTIME_DIRS.flatMap(dir => listSourceFiles(dir));
    /** 每处 PBKDF2 轮数的写法：`位置: 字面量值` */
    const sites: string[] = [];
    /** 每处 PBKDF2 轮数解析出的数值（含经 ALL_CAPS 模块常量中转的） */
    const values: number[] = [];
    /** 数值字面量真正所在的文件（多于一处 = 同一参数写了两遍，早晚漂移） */
    const owners = new Set<string>();
    /** 非法取值表达式：既非数字字面量、也非可回溯到字面量的模块常量 ⇒ 轮数可被配置/入参削弱 */
    const dynamic: string[] = [];

    for (const file of files) {
      const src = readSource(file);
      // 1) 参数对象里的 `iterations: …`（encryption / backupExport / identity.backup）
      for (const match of src.matchAll(/\biterations:\s*([^,}\n]+)/g)) {
        const raw = match[1].trim();
        const line = src.slice(0, match.index).split('\n').length;
        const where = `${file}:${line} ${raw}`;
        sites.push(where);
        const declIn = (text: string, name: string): number | null => {
          const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(\\d[\\d_]*)`).exec(text);
          return decl ? Number(decl[1].replace(/_/g, '')) : null;
        };

        if (/^\d[\d_]*$/.test(raw)) {
          values.push(Number(raw.replace(/_/g, '')));
          owners.add(file);
        } else if (/^[A-Z0-9_]+$/.test(raw)) {
          // 具名常量：回到声明处取值，禁止"名字像常量但值来自别处"；
          // 声明允许抽进独立的参数模块，因此跟着 import 说明符再找一次
          const local = declIn(src, raw);
          if (local !== null) {
            values.push(local);
            owners.add(file);
            continue;
          }
          const imported = namedImport(src, raw);
          const from = imported ? resolveSpecifier(imported.spec, file) : null;
          const remote = from === null ? null : declIn(readSource(from), imported!.original);
          if (from && remote !== null) {
            values.push(remote);
            owners.add(from);
          } else {
            dynamic.push(`${where}（既不在本文件取到数值，也跟随不到 import 来源）`);
          }
        } else {
          dynamic.push(where);
        }
      }
    }

    // 抽取非空：写法漂移（改名、换成对象展开）会让本守卫静默空跑
    expect(
      sites.length,
      `未在任何运行时代码里取到 PBKDF2 轮数，扫描已失效：${sites.join(', ')}`,
    ).toBeGreaterThanOrEqual(4);
    expect(dynamic, `PBKDF2 轮数被改成可外部影响的取值：${dynamic.join(' | ')}`).toEqual([]);
    expect(new Set(values), `PBKDF2 轮数出现非 600000 的档位：${sites.join(' | ')}`).toEqual(new Set([600000]));
    // 轮数不随密文落盘：四条派生路径（校验值 / 字段密钥 / .aph 备份 / .aphid 备份）各写一份
    // 就等于四个带外约定，任何一处漂移都是「解密失败」这一层查不出根因的静默故障。
    expect([...owners], `PBKDF2 轮数出现 ${owners.size} 个定义处，应只有一个：${sites.join(' | ')}`).toHaveLength(1);
  });

  it('取值跟随 import 的解析确实生效（否则上一条的"只有一个定义处"是空断言）', () => {
    const src = readSource('utils/encryption.ts');
    expect(src, 'encryption.ts 不再经 import 取轮数，本条跟随逻辑该一起改写').toMatch(
      /iterations:\s*PBKDF2_ITERATIONS/,
    );
    expect(namedImport(src, 'PBKDF2_ITERATIONS')?.spec, 'PBKDF2 参数模块不再被 encryption 引用').toBe(
      '@/utils/cryptoParams',
    );
  });
});
