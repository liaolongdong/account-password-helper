import { ref } from 'vue';

/**
 * Tag 标签溢出检测 Composable
 * 用于按需显示 tooltip：仅当标签文本实际发生截断（溢出）时才展示 tooltip
 *
 * @returns 溢出状态及相关检测方法
 */
export function useTagOverflow() {
  /** 记录当前发生文本溢出的标签文本，用于按需显示 tooltip */
  const overflowedTag = ref<string | null>(null);

  /**
   * 检查当前 hover 的标签是否发生文本溢出
   * 检测内层 .el-tag__content 元素，仅当 scrollWidth > clientWidth 时才标记为溢出
   *
   * @param e - 鼠标事件对象
   * @param tag - 标签文本
   */
  const checkTagOverflow = (e: MouseEvent, tag: string) => {
    const el = e.currentTarget as HTMLElement | null;
    if (!el) return;
    // 检测内层 .el-tag__content 是否发生文本截断
    const contentEl = el.querySelector('.el-tag__content') as HTMLElement | null;
    const target = contentEl ?? el;
    overflowedTag.value = target.scrollWidth > target.clientWidth ? tag : null;
  };

  /**
   * 判断指定标签是否处于溢出状态
   *
   * @param tag - 标签文本
   * @returns 是否溢出
   */
  const isTagOverflowed = (tag: string): boolean => overflowedTag.value === tag;

  return {
    overflowedTag,
    checkTagOverflow,
    isTagOverflowed,
  };
}
