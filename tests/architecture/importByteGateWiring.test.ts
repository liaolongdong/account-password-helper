/**
 * 导入字节闸门接线守卫
 *
 * 条数（`MAX_PASSWORD_IMPORT_ENTRIES`）与逐字段长度上限都在「整份文件读进内存并解码
 * /解密、逐条 parse」之后才生效，因此**防不住**「一次读取把任意大的输入拉进内存」这一步。
 * 补上的字节闸门必须**先于取字节**，而这一点在源码层是唯一可机械判定的位置：
 * 运行环境（jsdom 无 File、Node 无 chrome）里造不出 32 MiB 的真文件，
 * 而接线一旦回退（比如把判 size 挪到 `text()` 之后），页面不会报错，只会静默失去保护。
 *
 * 覆盖四条读取入口，且都钉住「抽取非空」——正则/标记失配时守卫必须红，
 * 不能空跑（仓库其他静态守卫正是这样失效过一次）。
 *
 * 同时守卫 `formatFileSize` 的单一事实来源：闸门文案要把上限值报给用户，
 * 组件里再留一份私有实现就会与常量分叉。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const IMPORT_DIALOG = 'components/options/ImportDialog.vue';
const BACKUP_IMPORT_DIALOG = 'components/options/BackupImportDialog.vue';
const IDENTITY_DIALOG = 'components/options/IdentityVaultDialog.vue';
const BACKUP_UTIL = 'utils/backupExport.ts';

/**
 * 取 `startMarker` 之后、`endMarker` 之前的一段源码
 *
 * 两个标记都必须能找到：定位失败即断言失败，而不是拿到空串让后续 `toContain`
 * 全部空跑。
 */
const sliceBetween = (source: string, startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  expect(start, `未找到起始标记（实现改名需同步本守卫）: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  expect(end, `未找到结束标记: ${endMarker}`).toBeGreaterThan(0);
  return rest.slice(0, end);
};

/** 断言闸门早于第一处读取动作（读取标记必须存在，否则视为抽取失败） */
const expectGateBeforeRead = (body: string, gate: string, readMarker: string): void => {
  const gateAt = body.indexOf(gate);
  const readAt = body.indexOf(readMarker);
  expect(gateAt, `缺少字节闸门: ${gate}`).toBeGreaterThanOrEqual(0);
  expect(readAt, `未找到读取动作标记: ${readMarker}`).toBeGreaterThan(gateAt);
};

describe('密码库导入的字节闸门', () => {
  it('ImportDialog：CSV/JSON 两条读取分支都先过 file.raw.size 闸门', () => {
    const body = sliceBetween(
      readSource(IMPORT_DIALOG),
      'const handleFileChange = async (file: UploadFile) => {',
      '\n};',
    );

    expect(body).toContain('MAX_PASSWORD_IMPORT_INPUT_BYTES');
    expectGateBeforeRead(body, 'file.raw.size > MAX_PASSWORD_IMPORT_INPUT_BYTES', 'file.raw.text()');
    expectGateBeforeRead(body, 'file.raw.size > MAX_PASSWORD_IMPORT_INPUT_BYTES', 'file.raw.arrayBuffer()');
  });

  it('backupExport：.aph 解密前先过闸门（UI 之外的调用路径同样受保护）', () => {
    const body = sliceBetween(readSource(BACKUP_UTIL), 'export async function importEncryptedBackup(', '\n}');

    expectGateBeforeRead(body, 'file.size > MAX_PASSWORD_IMPORT_INPUT_BYTES', 'await file.arrayBuffer()');
  });

  it('BackupImportDialog：选文件这一步就拒超限，不让用户填完主密码才被告知', () => {
    const body = sliceBetween(
      readSource(BACKUP_IMPORT_DIALOG),
      'const handleFileChange = async (file: UploadFile) => {',
      '\n};',
    );

    expectGateBeforeRead(body, 'file.raw.size > MAX_PASSWORD_IMPORT_INPUT_BYTES', 'selectedFile.value = file.raw');
  });
});

describe('身份库导入的字节闸门', () => {
  it('.aphid 与明文 .json 两条分支都在取字节/取文本之前过闸门', () => {
    const body = sliceBetween(
      readSource(IDENTITY_DIALOG),
      'const handleFileChange = async (event: Event): Promise<void> => {',
      '\n};',
    );

    expect(body).toContain('MAX_IDENTITY_IMPORT_INPUT_BYTES');
    expectGateBeforeRead(body, 'file.size > MAX_IDENTITY_IMPORT_INPUT_BYTES', 'importIdentityBackup(file');
    expectGateBeforeRead(body, 'file.size > MAX_IDENTITY_IMPORT_INPUT_BYTES', 'await file.text()');
  });

  it('身份库上限独立取值且严格小于密码库（30 条 PII 不需要 32 MiB 的口子）', async () => {
    const { MAX_IDENTITY_IMPORT_INPUT_BYTES } = await import('@/utils/identity/constants');
    const { MAX_PASSWORD_IMPORT_INPUT_BYTES } = await import('@/utils/backup/constants');

    expect(MAX_IDENTITY_IMPORT_INPUT_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_IDENTITY_IMPORT_INPUT_BYTES).toBeLessThan(MAX_PASSWORD_IMPORT_INPUT_BYTES);
  });
});

describe('formatFileSize 单一事实来源', () => {
  it('组件内不再各自实现（闸门文案的上限值必须与常量同源）', () => {
    for (const file of [IMPORT_DIALOG, BACKUP_IMPORT_DIALOG, IDENTITY_DIALOG]) {
      expect(readSource(file), `${file} 仍留有私有实现`).not.toMatch(/const\s+formatFileSize\s*=/);
      expect(readSource(file), `${file} 未复用公共实现`).toContain(
        "import { formatFileSize } from '@/utils/formatFileSize';",
      );
    }
  });
});
