<script lang="ts">
import { defineComponent } from 'vue';
import { toRichTextVNodes } from '@/utils/richText';

/**
 * 语言包富文本渲染器
 *
 * 取代 `v-html`：`<b>` / `<code>` 之外的任何标记降级为可见的字面文本，从根上取消
 * 「语言包字符串可以直接进 innerHTML」这条隐含信任（`AGENTS.md`「确需 HTML 时必须先采用
 * 经过审查的净化方案」——这里走更严格的结构化渲染，不需要净化器）。解析与建节点的全部
 * 规则在 `utils/richText.ts`，本组件只是把 `props.source` 接到 render 上。
 *
 * 采用 `defineComponent` + render 函数而非 `<script setup>` 模板，原因有两条：
 * 白名单元素的嵌套要递归产出节点，模板写出不自引用的递归；返回值必须是 Fragment，
 * 一旦插包装节点，宿主 `<li>` 的 DOM 结构就与替换 `v-html` 之前不一致。
 *
 * 同理，本组件不带任何样式：动态创建的子元素不带宿主的 scoped 作用域标识，
 * `code` / `b` 的呈现一律由宿主按后代选择器负责（见 `HelpDialog.vue` 的
 * `.el-dialog.help-dialog .help-section code`）。
 */
export default defineComponent({
  name: 'RichText',
  props: {
    /** 含白名单标记的语言包原始文案 */
    source: { type: String, required: true },
  },
  setup(props) {
    return () => toRichTextVNodes(props.source);
  },
});
</script>
