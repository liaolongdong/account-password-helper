/**
 * 标签颜色工具函数
 * 根据标签内容生成基于 HSL 色彩空间的自定义颜色，确保不同标签颜色区分度高、同一标签颜色始终一致。
 */
import type { PasswordEntry } from '@/utils/types';
import { hashStringLight } from '@/utils/crypto-light';
import { registerPlaintextCacheCleaner } from '@/utils/plaintextCacheCleanup';

/**
 * 解析标签字符串为数组
 * 支持英文逗号 `,` 与中文逗号 `，` 作为分隔符；自动去空白、过滤空项并去重。
 *
 * @param tag 原始标签字符串（可能为 undefined/空串）
 * @returns 去重后的标签数组
 */
export const parseTags = (tag: string | undefined | null): string[] => {
  if (!tag) return [];
  const parts = String(tag).split(/[,，]/);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

/**
 * 将标签数组规范化为以英文逗号拼接的字符串
 * 自动去空白、过滤空项并去重。
 *
 * @param tags 标签数组
 * @returns 规范化后的标签字符串
 */
export const stringifyTags = (tags: string[] | undefined | null): string => {
  if (!tags || !tags.length) return '';
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const trimmed = String(tag ?? '').trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result.join(',');
};

/**
 * 标签输入规整结果
 */
export interface NormalizedTagInput {
  /** 可写入的标签（已去空白、去空项、去重、剔除超长项，顺序与用户选择一致） */
  accepted: string[];
  /** 因超出单标签长度上限被丢弃的标签（调用方据此给出可读提示） */
  rejectedTooLong: string[];
}

/**
 * 规整用户选择的标签列表
 *
 * 与 `stringifyTags` 同口径（trim / 过滤空项 / 去重），额外把超长项分离出来而不是静默丢弃，
 * 供新增表单与批量编辑弹窗共用同一套「超长按上限丢弃并提示」判定。
 * 数量上限由调用方决定（表单侧截断并提示，批量弹窗侧由 `multiple-limit` 直接拦下）。
 *
 * @param tags 原始标签数组（可能含空白项、重复项与超限项）
 * @param maxLength 单个标签允许的最大字符数
 * @returns accepted / rejectedTooLong 两组标签
 */
export const normalizeTagInput = (tags: string[] | undefined | null, maxLength: number): NormalizedTagInput => {
  const accepted: string[] = [];
  const rejectedTooLong: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const tag = String(raw ?? '').trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    if (tag.length > maxLength) {
      rejectedTooLong.push(tag);
      continue;
    }
    accepted.push(tag);
  }
  return { accepted, rejectedTooLong };
};

/**
 * 聚合所有密码条目中的标签，返回去重后的候选项
 * 用于标签下拉框的候选列表。
 *
 * @param passwords 密码条目列表
 * @returns 去重后的标签候选数组
 */
export const collectAllTags = (passwords: Array<Pick<PasswordEntry, 'tag'>>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of passwords) {
    for (const tag of parseTags(p.tag)) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
};

/**
 * 标签颜色对象，包含背景色、文字色和边框色
 */
export interface TagColor {
  /** 背景色（HSL 浅色） */
  background: string;
  /** 文字色（HSL 深色） */
  text: string;
  /** 边框色（与文字色一致） */
  border: string;
}

/**
 * 字符串哈希函数
 * 复用 crypto-light 的 DJB2 变体实现（hashStringLight），将字符串映射为
 * 稳定的 32 位正整数，确保相同输入始终产生相同输出。
 *
 * @param str 输入字符串
 * @returns 非负整数哈希值
 */
const hashString = hashStringLight;

/**
 * 根据标签内容生成基于 HSL 色彩空间的自定义颜色
 *
 * 算法说明（轻雾色系）：
 * - 色相（Hue）：由标签字符串哈希映射到 0-359 度，保证不同标签色相均匀分布
 * - 饱和度（Saturation）：背景 40% / 文字 35% / 边框 35%，极低饱和度，轻柔不抢眼
 * - 亮度（Lightness）：背景 96%（近乎白底微染），文字 50%（浅灰调可读），边框 91%（极淡描边）
 * - 同一标签始终生成相同颜色，保证视觉一致性
 *
 * @param tag 标签文本
 * @returns 包含 background、text、border 的颜色对象
 */
export const getTagColor = (tag: string): TagColor => {
  const hue = hashString(tag) % 360;
  const background = `hsl(${hue}, 40%, 96%)`;
  const text = `hsl(${hue}, 35%, 50%)`;
  const border = `hsl(${hue}, 35%, 91%)`;
  return { background, text, border };
};

/**
 * 获取标签的完整内联样式对象（单次调用，避免模板中多次调用 getTagColor）
 *
 * 返回可直接绑定到 :style 的对象，包含背景色、文字色和边框色。
 * 适用于 el-tag 等需要同时设置 color 属性和 style 的场景。
 *
 * @param tag 标签文本
 * @returns 包含 background、color、borderColor 的样式对象
 */
export const getTagFullStyle = (tag: string): Record<string, string> => {
  const { background, text, border } = getTagColor(tag);
  return { background, color: text, borderColor: border };
};

/** 一条标签的呈现记录：名称与其内联样式 */
export interface TagPresentationRecord {
  /** 标签文本 */
  name: string;
  /** 可直接绑定到 :style 的样式对象（缓存内为冻结实例，禁止就地修改） */
  style: Readonly<Record<string, string>>;
}

/**
 * 标签呈现记录缓存上限
 *
 * 缓存键是条目上拼接后的原始 tag 字符串，规模上界是「库内去重后的标签组合数」，
 * 远小于条目数；超出上限时按插入顺序淘汰最旧一项，避免长会话下无上限增长。
 *
 * 键为条目上的明文标签，属明文在内存中的派生残留，因此上限只兜住体积、
 * 不兜住存活时间——存活时间由 {@link clearTagPresentationCache} 在锁定/过期时收口。
 */
const TAG_PRESENTATION_CACHE_MAX = 500;

/** 原始 tag 字符串 → 呈现记录数组（记录与数组均冻结，供多行安全共享） */
const tagPresentationCache = new Map<string, readonly TagPresentationRecord[]>();

/**
 * 构建列表渲染所需的标签名称与完整样式记录。
 *
 * 同一 tag 字符串的解析结果与颜色只与字符串本身有关，因此按字符串缓存并共享：
 * 大列表每行渲染原先要重复 `parseTags` + 每个标签一次 `hashString` 与三个 `hsl()` 模板串
 * （600 行约 1000+ 个标签），缓存后这部分降到一次 Map 命中。
 * 返回值已冻结，调用方只可读，不可就地修改。
 *
 * 调用方仍应在以原始 tag 字符串为依赖的 computed 中取值（侧边栏即如此），
 * 这样即使缓存未命中，也只在本行 tag 变化时重建。
 */
export const buildTagPresentationRecords = (tag: string | undefined | null): readonly TagPresentationRecord[] => {
  const key = tag ?? '';
  const cached = tagPresentationCache.get(key);
  if (cached) return cached;

  const records = Object.freeze(
    parseTags(key).map(name => Object.freeze({ name, style: Object.freeze(getTagFullStyle(name)) })),
  );
  if (tagPresentationCache.size >= TAG_PRESENTATION_CACHE_MAX) {
    const oldest = tagPresentationCache.keys().next();
    if (!oldest.done) tagPresentationCache.delete(oldest.value);
  }
  tagPresentationCache.set(key, records);
  return records;
};

/**
 * 清空标签呈现记录缓存
 *
 * 缓存键是条目上的原始标签字符串（明文），锁定或过期后不应继续以可寻址形式
 * 留在内存里，故与会话密钥材料同步销毁（安全基线：不延长明文的存活时间）。
 * 由本模块在初始化时登记进 `utils/plaintextCacheCleanup.ts`，
 * 会话边界在 clearSession 与跨上下文会话重置两处同步执行。
 * 只丢呈现缓存，不丢数据，也不影响 `getTagColor` 的
 * 确定性——同一标签重新计算得到同一颜色。
 */
export const clearTagPresentationCache = (): void => {
  tagPresentationCache.clear();
};

// 模块级登记：只有加载了本模块的上下文才持有这把缓存，会话边界据此同步销毁明文键残留
registerPlaintextCacheCleaner(clearTagPresentationCache);
