<template>
  <div class="password-list">
    <el-table
      ref="localTableRef"
      v-loading="loading"
      :element-loading-text="t('options.table.loading')"
      :empty-text="t('common.noData')"
      :data="data"
      style="width: 100%"
      stripe
      row-key="id"
      :row-class-name="rowClassName"
      :default-sort="{ prop: 'updateTime', order: 'descending' }"
      @selection-change="(selection: PasswordEntry[]) => $emit('selectionChange', selection)"
      @sort-change="(state: any) => $emit('sortChange', state)"
    >
      <el-table-column
        type="selection"
        width="36"
        fixed="left"
        reserve-selection
      />
      <el-table-column
        prop="username"
        :label="t('common.username')"
        min-width="150"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <SearchHighlight
            v-if="searchKeyword"
            :text="row.username"
            :keyword="searchKeyword"
          />
          <template v-else>{{ row.username }}</template>
        </template>
      </el-table-column>
      <el-table-column
        prop="password"
        :label="t('common.password')"
        min-width="110"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <div class="password-cell">
            <span v-if="!row.showPassword">{{ '*'.repeat(8) }}</span>
            <span v-else>{{ row.password }}</span>
            <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
            <el-button
              :icon="row.showPassword ? Hide : View"
              :aria-label="row.showPassword ? rowLabels.hidePassword : rowLabels.showPassword"
              link
              @click="$emit('togglePassword', row)"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column
        :label="t('common.totp')"
        min-width="120"
      >
        <template #default="{ row }">
          <TotpCode
            v-if="row.totp"
            :secret="row.totp"
            copyable
          />
          <span
            v-else
            class="no-tag"
            >-</span
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="url"
        :label="t('common.url')"
        min-width="200"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <template v-if="row.url">
            <a
              :href="normalizeUrl(row.url)"
              class="url-link"
              target="_blank"
              rel="noopener noreferrer"
              @click.stop
            >
              <!-- 网站图标（Chrome 本地缓存，零网络），无图标/加载失败时降级为原有链接图标 -->
              <SiteFavicon
                :url="row.url"
                :size="14"
              >
                <el-icon class="url-link__icon"><Link /></el-icon>
              </SiteFavicon>
              <span class="url-link__text">
                <SearchHighlight
                  v-if="searchKeyword"
                  :text="row.url"
                  :keyword="searchKeyword"
                />
                <template v-else>{{ row.url }}</template>
              </span>
            </a>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        prop="tag"
        :label="t('common.tag')"
        min-width="100"
        class-name="tag-col"
        sortable="custom"
      >
        <template #default="{ row }">
          <template v-if="tagRecordsOf(row).length">
            <el-tooltip
              v-for="tag in tagRecordsOf(row)"
              :key="tag.name"
              :content="tag.name"
              placement="top"
              :show-after="300"
              :disabled="!isTagOverflowed(tag.name)"
              :popper-style="TAG_TOOLTIP_POPPER_STYLE"
            >
              <el-tag
                :style="tag.style"
                :data-tag="tag.name"
                size="small"
                class="tag-item"
                @mouseenter="checkTagOverflow"
              >
                <SearchHighlight
                  v-if="searchKeyword"
                  :text="tag.name"
                  :keyword="searchKeyword"
                />
                <template v-else>{{ tag.name }}</template>
              </el-tag>
            </el-tooltip>
          </template>
          <span
            v-else
            class="no-tag"
            >-</span
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="remark"
        :label="t('common.remark')"
        min-width="150"
        sortable="custom"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <template v-if="row.remark">
            <SearchHighlight
              v-if="searchKeyword"
              :text="row.remark"
              :keyword="searchKeyword"
            />
            <template v-else>{{ row.remark }}</template>
          </template>
          <span
            v-else
            class="no-tag"
            >-</span
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="createTime"
        :label="t('sidepanel.createTime')"
        min-width="100"
        sortable="custom"
      >
        <template #default="{ row }">
          {{ formatDate(row.createTime) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="updateTime"
        :label="t('options.table.updateTime')"
        min-width="100"
        sortable="custom"
        :sort-orders="['descending', 'ascending', null]"
      >
        <template #default="{ row }">
          {{ formatDate(row.updateTime) }}
        </template>
      </el-table-column>
      <el-table-column
        :label="t('common.actions')"
        header-align="center"
        width="210"
        fixed="right"
      >
        <template #default="{ row }">
          <div
            class="operation-buttons"
            @click="closeOperationTip"
          >
            <!--
              操作提示改由全表共享的一个 el-tooltip 承载（见下方 operationTip）：
              原先每行 5 个实例，600 行就是 3000 个组件实例，实测占掉整表挂载耗时的四成。
              文案随按钮自带（data-tip），悬停只登记一个稳定引用的处理函数，
              不产生逐行闭包、也不产生逐行组件实例。
            -->
            <el-button
              :icon="View"
              :aria-label="rowLabels.viewDetail"
              :data-tip="rowLabels.viewDetail"
              circle
              size="small"
              @mouseenter="armOperationTip"
              @mouseleave="cancelOperationTip"
              @click="$emit('viewDetail', row)"
            />
            <el-button
              :icon="CopyDocument"
              :aria-label="rowLabels.copyEntry"
              :data-tip="rowLabels.copyEntry"
              circle
              size="small"
              @mouseenter="armOperationTip"
              @mouseleave="cancelOperationTip"
              @click="$emit('copy', row)"
            />
            <el-button
              :icon="Edit"
              :aria-label="rowLabels.edit"
              :data-tip="rowLabels.edit"
              circle
              size="small"
              @mouseenter="armOperationTip"
              @mouseleave="cancelOperationTip"
              @click="$emit('edit', row)"
            />
            <el-button
              :icon="row.favorite ? StarFilled : Star"
              :aria-label="row.favorite ? rowLabels.unfavorite : rowLabels.favorite"
              :data-tip="row.favorite ? rowLabels.unfavorite : rowLabels.favorite"
              circle
              size="small"
              :type="row.favorite ? 'warning' : 'default'"
              @mouseenter="armOperationTip"
              @mouseleave="cancelOperationTip"
              @click="$emit('toggleFavorite', row.id)"
            />
            <el-button
              :icon="Delete"
              :aria-label="rowLabels.delete"
              :data-tip="rowLabels.delete"
              circle
              size="small"
              type="danger"
              @mouseenter="armOperationTip"
              @mouseleave="cancelOperationTip"
              @click="$emit('deletePassword', row.id)"
            />
          </div>
        </template>
      </el-table-column>
    </el-table>
    <!--
      分页条：与表格同属这张卡片，因此挂在 `.password-list` 内部而不是 App 层，
      避免卡片圆角与外边距被拆成两段样式。它只读数与发事件，分页状态仍由
      `usePasswordManagement` 持有；这里逐字透传而不是打包成一个对象 prop——
      模板里现造对象会让本组件在父级每次渲染时都被判定为需要更新（见
      tests/architecture/optionsRenderIdentity.test.ts 记的那条性能陷阱）。
    -->
    <VaultPagination
      :current-page="currentPage"
      :page-count="pageCount"
      :page-size="pageSize"
      :total-count="totalCount"
      :selected-count="selectedCount"
      :off-page-selected-count="offPageSelectedCount"
      @update:current-page="page => $emit('update:currentPage', page)"
      @update:page-size="size => $emit('update:pageSize', size)"
    />
    <!--
      全表唯一的操作列提示实例。
      show-after 与被替换掉的逐行实例同值（400 毫秒）：第一次悬停某颗按钮时 Element Plus 还没把
      mouseenter 绑到它身上（虚拟触发点是在 mouseenter **之后**才改写的，那一帧不会再触发），
      这 400 毫秒由 operationTip 排程器持有；而再次悬停同一颗按钮时 EP 自己那份监听器会生效，
      两条路径必须落在同一个延迟上，否则二次悬停变成即时弹出（EP 的 open 又拿不到新文案）。
      hide-after 显式写死 200 毫秒，与逐行实例的默认值一致（含移入浮层保持显示的 enterable 行为）。
      transition 绑定见 operationTipTransition：只有一条路径需要跳过淡出。
    -->
    <el-tooltip
      ref="operationTipRef"
      virtual-triggering
      :virtual-ref="operationTipTriggerEl"
      :content="operationTipContent"
      :transition="operationTipTransition"
      placement="top"
      :show-after="400"
      :hide-after="200"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onUpdated, ref } from 'vue';
import { CopyDocument, Edit, Delete, View, Hide, Star, StarFilled, Link } from '@element-plus/icons-vue';
import type { PasswordEntry } from '@/utils/types';
import type { SortState } from '@/utils/passwordSort';
import { formatDate } from '@/utils/dateFormat';
import { buildTagPresentationRecords, type TagPresentationRecord } from '@/utils/tagUtils';
import { useTagOverflow } from '@/composables/useTagOverflow';
import { useSharedHoverTooltip } from '@/composables/useSharedHoverTooltip';
import TotpCode from '@/components/TotpCode.vue';
import SiteFavicon from '@/components/SiteFavicon.vue';
import SearchHighlight from '@/components/SearchHighlight.vue';
import VaultPagination from '@/components/options/VaultPagination.vue';
import { useI18n } from '@/utils/i18n';

/**
 * 密码列表表格组件
 *
 * 展示密码数据的完整表格，包含搜索排序、标签渲染、
 * 密码显隐切换和操作按钮（查看详情/复制/编辑/收藏/删除）。
 */
defineProps<{
  /** 表格数据（当前页切片） */
  data: PasswordEntry[];
  /** 加载状态 */
  loading: boolean;
  /** 行类名函数 */
  rowClassName?: (data: { row: PasswordEntry; rowIndex: number }) => string;
  /** 当前搜索关键词（用于命中高亮，空串时不高亮） */
  searchKeyword?: string;
  /** 当前页码（从 1 开始），供分页条读数 */
  currentPage: number;
  /** 总页数 */
  pageCount: number;
  /** 每页条数 */
  pageSize: number;
  /** 分页前的命中总条数 */
  totalCount: number;
  /** 已选中条数（跨页累计） */
  selectedCount: number;
  /** 已选中但不在当前页的条数 */
  offPageSelectedCount: number;
}>();

defineEmits<{
  selectionChange: [selection: PasswordEntry[]];
  sortChange: [state: { prop: string; order: string }];
  togglePassword: [row: PasswordEntry];
  viewDetail: [row: PasswordEntry];
  copy: [row: PasswordEntry];
  edit: [row: PasswordEntry];
  toggleFavorite: [id: string];
  deletePassword: [id: string];
  'update:currentPage': [page: number];
  'update:pageSize': [size: number];
}>();

const { t } = useI18n();

/**
 * 逐行插槽用到的常量文案
 *
 * 列的默认插槽由**每个单元格**各执行一次，所以写在插槽里的 `t()` 是「每行 × 每处」的量：
 * 操作列 5 个按钮的 `aria-label` + `data-tip` 共 10 次、密码列显隐按钮 1 次，
 * 一页 100 行就是 1100 次消息解析与依赖登记。实测挂载期的 CPU 自耗时里
 * `chunks/i18n-*.js` 的函数合计约占 13%（口径见
 * `docs/PERF_LARGE_VAULT_EVALUATION.md` 的首屏阶段拆分），而这段成本与行数无关、
 * 与用户是否看得见无关，纯属重复。
 *
 * 收成一个 computed 后：一次整表更新只解析一次，且仍然随语言切换失效重算——
 * `t()` 内部依赖 locale 与消息表，语言变化会让它重新求值，行内取值随之更新。
 */
const rowLabels = computed(() => ({
  viewDetail: t('options.detail.viewDetail'),
  copyEntry: t('options.table.copyEntry'),
  edit: t('common.edit'),
  favorite: t('common.favorite'),
  unfavorite: t('common.unfavorite'),
  delete: t('common.delete'),
  showPassword: t('common.showPassword'),
  hidePassword: t('common.hidePassword'),
}));

/** Tag 标签溢出检测 */
const { checkTagOverflow, isTagOverflowed } = useTagOverflow();

/**
 * 行标签呈现记录
 *
 * 样式对象取自 tagUtils 的有界缓存（同一标签字符串恒返回同一冻结对象），
 * 避免每次渲染为每个 `el-tag` 新建 `:style` 对象——新对象会被判定为 prop 变化，
 * 从而触发子组件更新，进而在大列表上放大整表重排成本。
 *
 * @param row 表格行数据
 * @returns 该行的标签呈现记录（只读）
 */
const tagRecordsOf = (row: PasswordEntry): readonly TagPresentationRecord[] => buildTagPresentationRecords(row.tag);

/**
 * 标签 tooltip 的 popper 样式（提升为组件级常量：随实例创建一次而非随渲染创建，
 * 对象身份稳定才不会让 el-tooltip 被判定为 prop 变化）
 */
const TAG_TOOLTIP_POPPER_STYLE = Object.freeze({ maxWidth: '500px', wordBreak: 'break-word' }) as const;

/** 表格引用（只经由文件末尾 `defineExpose` 的两个意图方法对外使用） */
const localTableRef = ref();

/**
 * 共享 tooltip 实例的最小方法集（`el-tooltip` 的暴露面，只声明本组件用到的两个）
 *
 * `onOpen` / `onClose` 是 Element Plus 的延迟开/关：二者共用实例内的同一个计时器槽位，
 * 因此「回到同一元素取消隐藏」「移入浮层保持显示」都由它自己完成，本组件不再插手隐藏时序。
 */
interface SharedTooltipInstance {
  /** `delay` 缺省取实例的 `show-after`（400 毫秒），本组件到点打开时显式传 0 */
  onOpen: (event?: MouseEvent, delay?: number) => void;
  onClose: (event?: MouseEvent, delay?: number) => void;
  /**
   * 立即关闭，不等 `hide-after`（触发元素已从文档上消失时用它，与逐行实例随节点卸载即消失对齐）。
   * 注意它只跳过 `hide-after` 的等待，浮层本身仍会淡出 300 毫秒，故需配合 `operationTipTransition`。
   */
  hide: () => void;
}

/** 全表唯一的操作列 tooltip 实例 */
const operationTipRef = ref<SharedTooltipInstance | null>(null);

/**
 * 跳过淡出时用的过渡名：仓库里没有对应的 CSS 类，Vue 的 `<Transition>` 在 leave 起始
 * 就取不到过渡类型，于是同帧把浮层摘掉（`whenTransitionEnds` 里 `!type` 直接 resolve）。
 */
const TOOLTIP_NO_FADE = 'aph-tooltip-no-fade';

/**
 * 浮层的淡出过渡名，`undefined` 即 Element Plus 默认的 `el-fade-in-linear`（300 毫秒淡出）。
 * 只有「触发元素被整表重渲染移除」那一条路径会临时切成 `TOOLTIP_NO_FADE`：该路径同时清空了文案，
 * 若照常淡出就会有一个空气泡在原位悬 300 毫秒，而逐行实例时代的观感是浮层随节点同帧消失。
 */
const operationTipTransition = ref<string>();

/**
 * 操作列提示排程器
 *
 * 逐行 5 个 `el-tooltip` 收敛成一个 `virtual-triggering` 实例后，第一次悬停某颗按钮时
 * Element Plus 还没有把 `mouseenter` 绑到它身上（虚拟触发点是在 `mouseenter` **之后**才被改写的，
 * EP 绑在新元素上的 `mouseenter` 这一帧不会再触发），所以那一次的 400 毫秒延迟由这里计时；
 * 再次悬停同一颗按钮时 EP 自己那份监听器已经在了，走它的 `show-after`——两个值必须相同，
 * 且到点开时必须显式传 `delay = 0`，否则"再划回同一颗按钮"会变成即时弹出 + 旧文案。
 * 关闭与 enterable 仍交给 EP。
 */
const {
  triggerEl: operationTipTriggerEl,
  content: operationTipContent,
  arm: armSharedTip,
  cancel: cancelOperationTip,
} = useSharedHoverTooltip({
  /** 与被替换掉的逐行实例保持同一天花板（400 毫秒） */
  showAfter: 400,
  /**
   * 到点打开：必须等本次写入触发的重渲染落地，再调用 EP 的 `onOpen`。
   *
   * `triggerEl` / `content` 是本组件模板读取的响应式值，写入即排一次重渲染，而重渲染会走
   * `onBeforeUpdate` 的兜底关闭；兜底关闭与打开共用 EP 实例内的同一个计时器槽位
   * （`useTimeout.registerTimeout` 先 `cancelTimeout` 再登记），若在 flush 之前打开，
   * 兜底关闭会把刚登记的 0 毫秒开启动作取消掉——真机表现为提示永远不出现。
   * 排在 flush 之后则相反：兜底关闭顺手取消了 EP 那条 400 毫秒的待开任务，由这里立即打开。
   */
  present: ({ event }) => {
    void nextTick(() => operationTipRef.value?.onOpen(event, 0));
  },
});

/**
 * 悬停入口：先把淡出档还原，再交给排程器计时。
 *
 * 还原必须落在 `mouseenter` 这一帧，不能落在 `present` 里：写这个 ref 会排一次本组件重渲染，
 * 而重渲染的 `onBeforeUpdate` 兜底关闭与 `onOpen` 共用 EP 实例内的同一个计时器槽位，
 * 同帧「先开后关」会把刚登记的 0 毫秒开启动作直接取消——真机表现为提示再也不出现。
 * 值未变化时 Vue 不会通知依赖，因此这条写入在正常路径上不产生额外渲染。
 */
const armOperationTip = (event: MouseEvent) => {
  operationTipTransition.value = undefined;
  armSharedTip(event);
};

/**
 * 关闭操作列提示
 * 用于点击操作按钮、以及每次重新渲染前兜底：避免弹窗/节点复用导致的 tooltip 残留
 */
const closeOperationTip = () => {
  cancelOperationTip();
  operationTipRef.value?.onClose();
};

/**
 * 每次重新渲染前先关掉已打开的浮层，避免弹窗/节点复用导致的 tooltip 残留。
 *
 * 这里**不取消挂起中的悬停**：本组件任何一次响应式写入都会走这个钩子，
 * 连排程一起取消的话，「刚按下鼠标进入、表格恰好重渲染」就会让提示永远不出现
 * （真机回归过一次，见 e2e 的「收藏态在两次悬停之间被切换」）。
 * 悬停的取消只属于 `@mouseleave`、点击与触发元素消失这三条明确路径。
 */
onBeforeUpdate(() => {
  operationTipRef.value?.onClose();
});

/**
 * 渲染后再兜一道：触发元素已经不在文档里（行被过滤掉、被删除、整批换掉）时立即关闭并放手。
 *
 * 逐行实例时代这些情形由实例随 `row` 一起卸载、浮层同帧消失；共享实例只剩
 * `onBeforeUpdate` 那条 200 毫秒的延迟关，而元素已卸载后它的 `mouseleave` 永远不会再来，
 * 于是浮层会原地悬停 200 毫秒。这里用 `hide()` 对齐"同帧消失"，同时释放对已脱离文档
 * 节点的引用（`triggerEl` 只在下次悬停时才会被改写）。
 *
 * `hide()` 之前先把过渡名切到无淡出档：清空文案后若照常淡出，原位会悬着一个空气泡 300 毫秒，
 * 比逐行实例时代多出一段可见残留（真机由 e2e/operation-tooltip.spec.ts 钉住）。
 */
onUpdated(() => {
  const trigger = operationTipTriggerEl.value;
  if (trigger && !trigger.isConnected) {
    operationTipTransition.value = TOOLTIP_NO_FADE;
    operationTipRef.value?.hide();
    cancelOperationTip();
    operationTipTriggerEl.value = undefined;
    operationTipContent.value = '';
  }
});

/**
 * 将 URL 文本归一化为可跳转的完整链接
 * @param url 原始 URL 文本
 * @returns 带协议的完整 URL
 */
const normalizeUrl = (url: string): string => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
};

/**
 * 对外只暴露意图，不交出 Element Plus 表格实例
 *
 * 父组件需要的只有两件事：命中集合变化时把跨页保留的选中归零、从存储恢复表头排序指示器。
 * 原先交出 `tableRef` 让调用点越过本组件的契约直接调 EP 方法，表格一旦换实现或加包装，
 * 散在外部的 `.tableRef.xxx` 会静默失效（`clearSelection` 那条补偿接线尤其吃这一点）。
 * 这里包一层，EP 实例的判空也收在内部——未挂载时调用与原先的 `?.` 同样为无操作。
 */
defineExpose({
  /** 清空选中集（`reserve-selection` 模式下 EP 不会随 `data` 换引用自动清，必须由外部显式触发） */
  clearSelection: () => localTableRef.value?.clearSelection(),
  /** 恢复表头排序指示器：`prop` / `order` 原样转给 EP，不回写任何组件状态 */
  applySort: (prop: string, order: NonNullable<SortState['order']>) => localTableRef.value?.sort(prop, order),
});
</script>

<style scoped>
/* 密码列表容器 */
.password-list {
  margin: 0 32px 32px;
  overflow: hidden;
  background: white;
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
}

.password-cell {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

/* 表格行动画 */
:deep(.el-table__body-wrapper .el-table__row) {
  transition: all 0.3s ease;
}

:deep(.el-table__body-wrapper .el-table__row:hover) {
  box-shadow: 0 2px 8px rgb(var(--aph-primary-rgb) / 20%);
  transform: translateY(-2px);
}

/* 新增条目高亮动画 */
:deep(.el-table__body-wrapper .el-table__row.new-item) {
  animation: fade-in 1s linear;
}

@keyframes fade-in {
  0% {
    transform: translateY(-20px);
  }
  50% {
    transform: translateY(-10px);
  }
  100% {
    transform: translateY(0);
  }
}

:deep(.el-table__body-wrapper .el-table__row.new-item td) {
  border-bottom: 2px solid var(--el-color-success);
}

/** 删除密码列表动效 */
:deep(.el-table__body-wrapper .el-table__row.del-item) {
  animation: fade-out 1s ease-in-out;
}

@keyframes fade-out {
  0% {
    opacity: 1;
    transform: translateX(0);
  }
  100% {
    opacity: 0;
    transform: translateX(800px);
  }
}

/* 表格操作栏样式 */
:deep(.el-table-fixed-column--right .cell) {
  padding: 0 8px;
}

/* 标签列单元格允许溢出 */
:deep(.tag-col .cell) {
  overflow: visible;
}

/* 标签样式 */
.tag-item {
  box-sizing: border-box;

  /* 上限 110px，同时不超过所在单元格宽度：窄列时随之收缩，避免标签溢出单元格导致右侧圆角被相邻列覆盖/裁切 */
  max-width: min(110px, 100%);
  padding: 0 8px;
  margin: 0;
  overflow: visible !important;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  cursor: default;
  border-radius: 4px;
}

.tag-item :deep(.el-tag__content) {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-item + .tag-item {
  margin-left: 4px;
}

/* 标签内高亮：沿用标签自身配色，仅加粗强调，避免主题色与标签底色冲突 */
.tag-item :deep(.search-hit) {
  font-weight: 700;
  color: inherit;
}

.no-tag {
  font-size: 12px;
  font-style: italic;
  color: #c0c4cc;
}

/* 操作按钮样式 */
.operation-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.operation-buttons .el-button {
  position: relative;
  width: 28px;
  height: 28px;
  padding: 0;
  margin-left: 10px;
}

/* 扩大触控热区至约 38px（视觉尺寸不变）；inset 5px 与按钮间距 10px 匹配，相邻热区恰好相接不重叠 */
.operation-buttons .el-button::after {
  position: absolute;
  inset: -5px;
  content: '';
}

:deep(.operation-buttons .el-button--danger:hover) {
  color: #fff;
  background: #e04040;
  border-color: #e04040;
}

/* URL 链接样式 */
.url-link {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  max-width: 100%;
  color: var(--el-color-primary);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s;
}

.url-link:hover {
  color: var(--el-color-primary-light-3);
  text-decoration: underline;
}

.url-link__icon {
  flex-shrink: 0;
  font-size: 14px;
}

.url-link__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 响应式 */
@media (width <= 768px) {
  .password-list {
    margin: 0 16px 16px;
  }
}
</style>
