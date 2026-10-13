/**
 * 项目级常量定义
 *
 * 只放跨领域共享的值（字段容量 `PASSWORD_FIELD_LIMITS`、标签容量 `MAX_TAG_COUNT` /
 * `MAX_TAG_LENGTH`），且保持依赖极浅（仅口令生成器的长度常量）。
 * URL 常量在 `utils/urls.ts`，单一领域内的常量留在各自模块。
 */
import { MAX_PASSWORD_LENGTH } from '@/utils/passwordGenerator';
import { MAX_PASSPHRASE_LENGTH } from '@/utils/passphraseGenerator';

/**
 * 密码字段的长度容量（单一事实来源）
 *
 * 取两个口令生成器可能输出的最长值，供输入框 `maxlength`、`formValidators` 的
 * 校验规则与 background 落盘兜底共用。任一处单独收窄都会把合法生成的口令静默
 * 截断或在编辑态误拒，用户无从察觉。
 */
export const PASSWORD_FIELD_MAX_LENGTH = Math.max(MAX_PASSWORD_LENGTH, MAX_PASSPHRASE_LENGTH);

/**
 * 密码条目各字段的长度容量（单一事实来源）
 *
 * 输入框 `maxlength`、Element Plus 校验规则与 background 落盘兜底共用同一组数字。
 * 三处各自定义时，任一处单独收窄都会把合法输入静默截断或在编辑态误拒，放宽一方
 * 则会让网页 DOM、跨上下文消息等不可信来源写入超出容量的数据 —— 这类条目事后
 * 无法被表单保存回去，用户只能删条重建。
 *
 * `tag` 仅约束 SidePanel 快速添加这一条短通道（输入框 `maxlength` 与 `quickAddHandler` 拒收
 * 超长）；Options 标签编辑器由 `MAX_TAG_COUNT` × `MAX_TAG_LENGTH` 独占归一化（序列化串可长于
 * 本值），自动保存与保存弹窗通道刻意不受本值限制——它们会预填条目已有的标签串，按本值截断
 * 等于把用户自己写的合法标签静默改短。tag 规则也不在 `createPasswordFormRules` 里，见其注释。
 *
 * 放在本模块而不是 `formValidators`：存储层与后台落盘只关心容量，不该为了取一组
 * 数字而静态依赖表单校验模块（那会把校验器整块带进 popup 等入口的首屏预加载清单）。
 */
export const PASSWORD_FIELD_LIMITS = {
  username: 50,
  password: PASSWORD_FIELD_MAX_LENGTH,
  url: 100,
  tag: 50,
  remark: 1000,
} as const;

/**
 * 最多可选择的标签数量
 *
 * 上限 5 是「扁平标签够用」这条产品判断的容量前提：用户反馈里「想按站点/项目/环境
 * 多层组织」的诉求，先用「一个维度一个标签」的扁平组合覆盖，而不是引入层级分组
 * （层级会带来「同一条目属于几个文件夹」的模型改动，见
 * docs/reports/FEATURE_CANDIDATES_EVALUATION.md）。3 个维度不够拼出这种组合。
 *
 * 放宽后的序列化串最长 5 × 30 + 4 = 154 字符，仍低于导入闸门 `MAX_TAG_LEN`（256），
 * 自导出 → 回灌闭环不受影响；SidePanel 快速添加通道的 `PASSWORD_FIELD_LIMITS.tag`
 * （50）刻意不跟随——那条通道只有一个短输入框，不承担多维标注。
 */
export const MAX_TAG_COUNT = 5;

/**
 * 单个标签最大字符长度
 *
 * 与表单校验规则、超限提示文案、`normalizeTagInput` 的丢弃阈值共用同一个数字；
 * content 侧的采集上限（`utils/capturedTag.ts` 的 `CAPTURED_TAG_MAX_LENGTH`）刻意不 import
 * 本值，由 `tests/utils/capturedTag.test.ts` 钉住两者的同口径关系。
 */
export const MAX_TAG_LENGTH = 30;
