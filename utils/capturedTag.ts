/**
 * 自动保存的标签预填清洗
 *
 * content script 捕获登录凭证时把整串 `document.title` 当作标签预填。页面标题的常见形态是
 * 「页面名 · 站点名」，整串直接用有三个后果：长度普遍超过单标签上限（后台刻意不限 tag 长度，
 * 于是这条超长标签会一路落库，直到用户下次在编辑弹窗里改动标签时被 `normalizeTagInput` 丢掉并
 * 弹警告，等于预填了一个「一改就没」的值）、含逗号时会被 `parseTags` 拆成两三个标签，以及保存后
 * 往标签候选池灌进一个一次性字符串（候选池由条目聚合而来，见 `countTags`，标签筛选随之变
 * 噪音）。本模块把标题收敛成一个短、稳定、无逗号的可读候选；收敛不出来时宁可不预填——标签是用户
 * 自己的归类维度，不是页面名的副本。
 */
import { getMainDomain } from '@/utils/domain';

/**
 * 预填标签的长度上限
 *
 * 与 Options 标签编辑器的单标签上限同口径（`composables/usePasswordManagement` 的
 * `MAX_TAG_LENGTH`）：超过该值的预填逃得过落库（后台不限 tag），却逃不过编辑弹窗——用户下次
 * 改动标签时它会被归一化丢掉，等于给了一个「一改就没」的值。
 *
 * 刻意在本模块写死这个数字，而不是 import 那个 composable——content script 首屏 chunk 不该为
 * 一个常量带上整块标签管理组合式函数（Vue 响应式 + storage 依赖）。两者的同口径关系由
 * `tests/utils/capturedTag.test.ts` 钉住，只改一处会直接测红。
 */
export const CAPTURED_TAG_MAX_LENGTH = 30;

/**
 * 强分隔符：任意位置都视作标题分段
 *
 * 包含中英文逗号与中文顿号——逗号本身就是标签之间的分隔符（见 `parseTags`），绝不能残留在预填
 * 值里，否则一串标题会被拆成多个标签；顺带把「正品低价、品质保障」这类中段枚举切断，使候选
 * 收敛到首末段。
 */
const STRONG_SEPARATOR = /[·•|｜»›→–—―－，,、]/;

/**
 * 弱分隔符：仅当左右至少一侧是空白时才视作分段
 *
 * `E-commerce`、`12:30`、`a/b` 里的连字符与冒号属于名称本身，无条件切分会把站点名切成
 * 「E」「commerce」两段，再让候选选取挑出更短的垃圾。
 */
const WEAK_SEPARATOR = /[-:：/]/;

/**
 * 把已归一化（空白压成单空格）的标题切成候选分段
 *
 * @param title 归一化后的页面标题
 * @returns 去空白、过滤空项后的分段数组，顺序与标题中一致
 */
const splitTitleSegments = (title: string): string[] => {
  const segments: string[] = [];
  let current = '';

  const flush = () => {
    const segment = current.trim();
    if (segment) segments.push(segment);
    current = '';
  };

  for (let index = 0; index < title.length; index += 1) {
    const char = title[index];
    if (STRONG_SEPARATOR.test(char)) {
      flush();
      continue;
    }
    if (WEAK_SEPARATOR.test(char)) {
      const prevChar = index === 0 ? ' ' : title[index - 1];
      const nextChar = index === title.length - 1 ? ' ' : title[index + 1];
      if (/\s/.test(prevChar) || /\s/.test(nextChar)) {
        flush();
        continue;
      }
    }
    current += char;
  }
  flush();

  return segments;
};

/**
 * 从 hostname 取站点名锚点
 *
 * 主域名（`getMainDomain`）的首段就是绝大多数站点自报的品牌词：`www.github.com → github`、
 * `www.taobao.com.cn → taobao`。单字母锚点（`t.co`）与空值返回空串，因为一个字符的包含判断
 * 会在标题里到处误命中。
 *
 * @param hostname 当前页面 hostname
 * @returns 小写站点名锚点，取不到时为空串
 */
const hostLabelOf = (hostname: string | undefined | null): string => {
  if (!hostname) return '';
  const label = getMainDomain(hostname).split('.')[0] ?? '';
  return label.length >= 2 ? label.toLowerCase() : '';
};

/**
 * 按「站点名最可能出现在哪」给分段排出候选次序
 *
 * 1. 命中站点名锚点的首/末段——域名与标题品牌词同源时最可靠（`Amazon.com: Online Shopping…`）；
 * 2. 末段、首段——「页面名 - 站点名」是主流排版，站点名也常写在最前（`GitHub: …`）；
 * 3. 其余中段按长度升序——只在首末段都装不下时才退到这里，避免选中长页面名。
 *
 * 排序刻意不看长度（长度只用于上限判定），否则 `Home - Gmail` 会选中更短的 `Home` 而不是站点名。
 *
 * @param segments 标题分段（非空）
 * @param hostLabel 站点名锚点，可为空串
 * @returns 候选次序的分段数组（可能含重复项，由调用方按上限逐个试）
 */
const rankSegments = (segments: string[], hostLabel: string): string[] => {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const ends = first === last ? [first] : [last, first];
  const hostHits = hostLabel ? ends.filter(end => end.toLowerCase().includes(hostLabel)) : [];
  const plainEnds = ends.filter(end => !hostHits.includes(end));
  const middles = segments.slice(1, -1).sort((a, b) => a.length - b.length);
  return [...hostHits, ...plainEnds, ...middles];
};

/**
 * 从页面标题导出自动保存的标签预填值
 *
 * @param title 页面标题（宿主页面可控的不可信文本）
 * @param hostname 当前页面 hostname，用作站点名锚点；缺省时只按首末段位置偏好选取
 * @param maxLength 预填值长度上限，默认 {@link CAPTURED_TAG_MAX_LENGTH}
 * @returns 可直接作为标签的短字符串；所有候选都超上限时为空串（不预填）
 */
export const deriveCapturedTag = (
  title: string | undefined | null,
  hostname?: string | undefined | null,
  maxLength = CAPTURED_TAG_MAX_LENGTH,
): string => {
  const normalized = String(title ?? '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  if (!normalized) return '';

  const segments = splitTitleSegments(normalized);
  if (segments.length === 0) return '';

  return rankSegments(segments, hostLabelOf(hostname)).find(segment => segment.length <= maxLength) ?? '';
};
