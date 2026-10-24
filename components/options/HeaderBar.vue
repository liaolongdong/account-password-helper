<template>
  <div class="header">
    <!-- 第一行：标题和Logo -->
    <div class="header-title-row">
      <div class="header-title">
        <h1>
          <BrandLogo class="logo" />
          {{ t('appName') }}
          <!-- 版本号可点击：与 Popup / 帮助弹窗的版本链接心智一致，跳转 GitHub Releases 查看最新版本与下载 -->
          <a
            class="version-tag-link"
            :href="GITHUB_RELEASES_PAGE_URL"
            target="_blank"
            rel="noopener noreferrer"
            :title="t('options.header.versionLinkTitle')"
          >
            <el-tag
              size="small"
              type="info"
              class="version-tag"
            >
              v{{ currentVersion }}
            </el-tag>
          </a>
        </h1>
      </div>
      <!-- 状态区：备份徽标 + 会话剩余时间徽标 + 一键锁定。三者都是「看一眼就知道现在安不安全」
           的常驻状态，按邻近原则同处一行右端；锁定刻意不进任何下拉——离座前锁掉是高频安全动作，
           原来只能从「安全设置 → 有效期设置 → 清除会话」三步抵达。
           备份徽标排在最左：它表达的是库的健康（天级），与会话（秒级）分属两种时间尺度，
           放一起时先读更慢变的那个。 -->
      <div class="header-status">
        <button
          v-if="backupChip.visible"
          type="button"
          class="backup-chip"
          :class="`backup-chip--${backupChip.level}`"
          :title="backupChipDetail"
          :aria-label="t('options.header.backupChipAria', { detail: backupChipDetail })"
          @click="handleBackupChipClick"
        >
          <span
            class="backup-chip__dot"
            aria-hidden="true"
          ></span>
          <el-icon><FolderChecked /></el-icon>
          <span class="backup-chip__text">{{ backupChipText }}</span>
        </button>
        <button
          v-if="remainingText"
          type="button"
          class="session-chip"
          :class="{ 'session-chip--urgent': isUrgent, 'session-chip--critical': isCritical }"
          :title="t('options.header.sessionChipTitle')"
          @click="$emit('openValidity')"
        >
          <span
            class="session-chip__pulse"
            aria-hidden="true"
          ></span>
          <el-icon><Timer /></el-icon>
          <span class="session-chip__time">{{ remainingText }}</span>
        </button>
        <el-button
          class="lock-btn"
          :icon="Lock"
          :loading="lockLoading"
          :title="t('options.header.lockNowTitle')"
          @click="$emit('lockNow')"
        >
          {{ t('options.header.lockNow') }}
        </el-button>
      </div>
    </div>

    <!-- 第二行：操作按钮 -->
    <div class="header-actions-row">
      <div class="header-actions">
        <el-button
          data-tour="add"
          type="primary"
          :icon="Plus"
          @click="$emit('addPassword')"
        >
          {{ t('options.header.addPassword') }}
        </el-button>
        <el-button
          data-tour="health"
          :icon="Aim"
          :title="healthGrade ? t('options.header.healthScore', { score: healthScore ?? 0 }) : undefined"
          @click="$emit('openHealth')"
        >
          {{ t('options.header.healthCheck') }}
          <span
            v-if="healthGrade"
            class="health-dot"
            :style="{ backgroundColor: healthDotColor }"
            role="img"
            :aria-label="t('options.header.healthScore', { score: healthScore ?? 0 })"
          ></span>
        </el-button>
        <!-- 个人信息库是第二份数据域（独立复验门槛、独立回收站与表单），
             此前蜷在「数据管理」菜单最后一项，与「导出 CSV」同级；提为一级入口后，
             「数据管理」回归迁移 / 备份 / 维护三件事，不再承载另一个库 -->
        <el-button
          :icon="Postcard"
          :title="t('identity.vaultEntryTitle')"
          @click="$emit('openIdentity')"
        >
          {{ t('identity.title') }}
        </el-button>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => $emit('dataCommand', cmd)"
        >
          <el-button
            data-tour="data"
            :icon="FolderOpened"
          >
            {{ t('options.header.data') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <!-- 备份状态已上移到头部徽标（唯一事实来源），菜单这里不再重复展示一份：
                   同一屏两处显示同一事实，早晚漂移。 -->
              <!-- 四组按旅程排列，组内只有一个意图：取模板并灌入 → 明文导出给人看 →
                   加密备份的导出与回灌 → 库内维护。
                   「下载模板」是导入的前置件，因此排在「导入数据」之前；
                   明文导出与 .aph 加密备份刻意分成两组，前者是「给别人用的表」、
                   后者是「给自己回滚的快照」，混在一组会让用户在导出簇里误点备份导出 -->
              <el-dropdown-item
                command="downloadTemplate"
                :icon="Document"
              >
                {{ t('options.header.downloadTemplate') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="import"
                :icon="Upload"
              >
                {{ t('options.header.importData') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="export"
                :icon="Download"
              >
                {{ t('options.header.exportData') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="exportJson"
                :icon="Download"
              >
                {{ t('options.header.exportJson') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="backupExport"
                :icon="Lock"
              >
                {{ t('options.header.backupExport') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="backupImport"
                :icon="Unlock"
              >
                {{ t('options.header.backupImport') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="emailBackup"
                :icon="Message"
              >
                {{ t('options.header.emailBackup') }}
              </el-dropdown-item>
              <!-- 去重与回收站同为「整理既有数据」，但图标必须区分：两者此前共用 Delete，
                   展开前完全看不出哪个是动作、哪个是查看已删除 -->
              <el-dropdown-item
                divided
                command="removeDuplicates"
                :icon="CopyDocument"
              >
                {{ t('options.header.removeDuplicates') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="trash"
                :icon="Delete"
              >
                {{ t('options.header.trash') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => $emit('settingsCommand', cmd)"
        >
          <el-button
            data-tour="settings"
            :icon="Setting"
          >
            {{ t('options.header.securitySettings') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <!-- 四组各管一件事：主密码本身 → 会话与锁定 → 填充与保存行为 → 隐私留痕与容量。
                   「快捷键」是一览型内容而非可配置策略，已移到「帮助」下拉；
                   「收藏上限」与剪贴板、密码历史同属「留痕与容量」，不再单独占一组 -->
              <el-dropdown-item
                command="changeMasterPassword"
                :icon="Key"
              >
                {{ t('options.header.changeMasterPassword') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="recovery"
                :icon="Notebook"
              >
                {{ t('recovery.settingsTitle') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="validity"
                :icon="Timer"
              >
                {{ t('options.header.validity') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="idleLock"
                :icon="Clock"
              >
                {{ t('options.header.idleLock') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="identityAccess"
                :icon="Postcard"
              >
                {{ t('options.header.identityAccess') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="autoSave"
                :icon="FolderChecked"
              >
                {{ t('options.header.autoSave') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="siteRules"
                :icon="Link"
              >
                {{ t('options.header.siteRules') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="domainMatch"
                :icon="Connection"
              >
                {{ t('options.header.domainMatch') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="clipboard"
                :icon="DocumentCopy"
              >
                {{ t('options.header.clipboard') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="passwordHistory"
                :icon="Document"
              >
                {{ t('options.historySetting.title') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="favoriteLimit"
                :icon="Star"
              >
                {{ t('options.header.favoriteLimit') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <!-- 偏好设置紧贴「安全设置」：两个配置入口分居工具条两端时，用户要先做一次
             「这条算安全还是算偏好」的归类判断；物理相邻让这扇门只需要被找到一次。
             `data-tour="personalize"` 是引导剧本第 9 步的锚点，键名不可改 -->
        <el-button
          data-tour="personalize"
          :icon="Brush"
          @click="$emit('openPersonalization')"
        >
          {{ t('options.header.personalization') }}
        </el-button>
      </div>
      <!-- 右侧工具区：只留「查找功能」这一件事的两颗按钮。
           帮助下拉收敛了 新手引导 / 使用指引 / 快捷键 / 关于 四个低频元入口——它们此前与
           「添加密码」同权重常驻，占掉工具条一半以上的实面积；收起来不损失可达性，
           四项在命令面板里仍可按名字检索到。
           这里刻意保留文字标签而不是收成图标：放大镜单独出现会被读成「搜索密码列表」
           （真正的检索框就在下方），而「帮助 / Help」两个字比纯图标 + 下拉箭头还窄。 -->
      <div class="header-actions-right">
        <el-button
          :icon="Search"
          :title="t('options.header.commandPaletteTitle')"
          :aria-label="t('options.header.commandPaletteTitle')"
          @click="$emit('openCommandPalette')"
        >
          {{ t('options.header.commandPalette') }}
          <kbd
            class="cp-kbd"
            aria-hidden="true"
            >{{ t('options.header.commandPaletteKbd') }}</kbd
          >
        </el-button>
        <el-dropdown
          trigger="click"
          @command="handleHelpCommand"
        >
          <el-button
            :icon="QuestionFilled"
            :title="t('options.header.helpTitle')"
          >
            {{ t('options.header.help') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                command="tour"
                :icon="Compass"
              >
                {{ t('options.header.tour') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="guide"
                :icon="Reading"
              >
                {{ t('options.header.guide') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="shortcuts"
                :icon="Operation"
              >
                {{ t('options.header.shortcuts') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="about"
                :icon="InfoFilled"
              >
                {{ t('options.header.about') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import {
  Plus,
  Download,
  Upload,
  Delete,
  Setting,
  Message,
  FolderChecked,
  ArrowDown,
  FolderOpened,
  Timer,
  Lock,
  Unlock,
  Clock,
  DocumentCopy,
  Star,
  Aim,
  Key,
  Notebook,
  Document,
  Brush,
  Compass,
  Reading,
  Operation,
  Link,
  Connection,
  Postcard,
  InfoFilled,
  Search,
  QuestionFilled,
  CopyDocument,
} from '@element-plus/icons-vue';
import type { HealthGrade } from '@/utils/passwordHealth';
import type { BackupChipState, BackupVaultChipDetail } from '@/utils/backup/changeDetection';
import BrandLogo from '@/components/BrandLogo.vue';
import { GITHUB_RELEASES_PAGE_URL } from '@/utils/urls';
import { useI18n } from '@/utils/i18n';
import { useSessionCountdown } from '@/composables/useSessionCountdown';

/**
 * Options 页面头部组件
 *
 * 两行结构：第一行是身份与会话（标题 / 版本 / 会话剩余时间 / 一键锁定），
 * 第二行左侧是「做事与配置」（添加密码 → 安全体检 → 个人信息库 → 数据管理 → 安全设置 → 偏好设置），
 * 右侧是「查找功能」（命令面板、帮助）。
 *
 * 排布判据：常驻控件压到 8 颗，低频元入口收进「帮助」下拉；两个配置入口（安全设置 / 偏好设置）
 * 物理相邻，省掉用户「这条算安全还是算偏好」的归类判断；命令面板与「帮助」里的四项在
 * 命令面板中仍可检索到，收敛不损失可达性。
 * 「安全设置」管主密码、会话与填充行为，「偏好设置」面板管外观与填充交互，图标区分避免混淆
 * （Brush 与齿轮刻意不同族）。快捷键是只读一览、属查找型内容，因此落在「帮助」而非「安全设置」。
 * 语言切换在「偏好设置」面板（与主题风格同组，三入口可达）。
 *
 * 带 `data-tour` 的按钮是聚光引导的锚点，键名与 `utils/onboardingTour.ts` 的剧本一一对应；
 * 删除或改名会静默让对应步骤消失（锚点缺失即跳步），改动时请同步剧本。
 */
const props = defineProps<{
  /** 当前插件版本号 */
  currentVersion: string;
  /** 综合安全评分（0~100），空库时不传 */
  healthScore?: number;
  /** 健康等级，空库时不传（决定是否显示体检小圆点） */
  healthGrade?: HealthGrade;
  /** 备份徽标状态（档位判据在 `utils/backup/changeDetection` 的纯函数里，本组件只负责呈现） */
  backupChip: BackupChipState;
  /** 一键锁定进行中（复用有效期设置里的清除会话链路的加载态） */
  lockLoading?: boolean;
}>();

const emit = defineEmits<{
  /** 点击添加密码按钮 */
  addPassword: [];
  /** 打开安全体检弹窗 */
  openHealth: [];
  /** 数据管理菜单项点击 */
  dataCommand: [command: string];
  /** 安全设置菜单项点击 */
  settingsCommand: [command: string];
  /** 打开偏好设置弹窗 */
  openPersonalization: [];
  /** 点击会话徽标，打开有效期设置弹窗 */
  openValidity: [];
  /** 一键锁定当前会话（与有效期设置里的「清除会话」同一条链路） */
  lockNow: [];
  /** 打开个人信息库列表弹窗 */
  openIdentity: [];
  /** 重温新手引导 */
  openTour: [];
  /** 打开页内「使用指引」文档中页 */
  openGuide: [];
  /** 打开快捷键一览弹窗（只读） */
  openShortcuts: [];
  /** 打开命令面板 */
  openCommandPalette: [];
  /** 打开「关于」抽屉 */
  openAbout: [];
}>();

const { t } = useI18n();

/**
 * 命令面板按钮上的快捷键键帽（文案在语言包里，取跨平台写法 `Ctrl/⌘K`）
 *
 * 刻意**不做**平台嗅探：`utils/platform.ts` 同时被后台预热与快捷键清单引用，
 * 让管理页再静态引它一次，Rollup 会把这份共享代码切成独立 chunk，
 * 于是 popup 首屏的 eager 预加载多出一个文件（被 `sidepanelClosure` 的预算守卫挡下）。
 * 为一个键帽 glyph 给另一个入口的首屏加一次请求不值得，故与既有 tooltip
 * 「打开命令面板（Ctrl/Cmd+K）」保持同一口径。
 *
 * 键帽 `aria-hidden`：无障碍名仍由按钮的 `aria-label` 承载，避免读屏把「命令面板」
 * 与快捷键念两遍；可见文字「命令面板」是 aria-label 的子串，满足 WCAG 2.5.3。
 */

/**
 * 「帮助」下拉的命令分派
 *
 * 四项各自透出一个既有事件，父层监听与业务行为完全不变——收敛的只是入口形态，
 * 不是能力。未知命令不落任何动作（EP 只会回抛本组件写出的 command）。
 */
const handleHelpCommand = (command: string): void => {
  switch (command) {
    case 'tour':
      emit('openTour');
      break;
    case 'guide':
      emit('openGuide');
      break;
    case 'shortcuts':
      emit('openShortcuts');
      break;
    case 'about':
      emit('openAbout');
      break;
  }
};

/**
 * 备份徽标的出口按「最差的那一库」分派
 *
 * 两个库是两份互不覆盖的备份：密码库走「数据管理 → 加密备份导出」（`.aph`），
 * 个人信息库的 `.aphid` 导出只在库内弹窗里。徽标因个人信息库亮红时若仍把点击
 * 送到 `.aph` 导出，用户按提示做完会发现红色纹丝不动——出口必须落在真正欠的那份备份上。
 */
const handleBackupChipClick = (): void => {
  if (props.backupChip.worstVault === 'identity') {
    emit('openIdentity');
    return;
  }
  emit('dataCommand', 'backupExport');
};

// 会话倒计时：HeaderBar 仅在认证态挂载，挂载即启动；作用域销毁自动停止
const { remainingText, isUrgent, isCritical, start: startCountdown } = useSessionCountdown();
onMounted(() => {
  startCountdown();
});

/**
 * 体检小圆点颜色（一眼可见的红黄绿信号灯）
 * 优秀/良好为绿色（健康），一般为橙色（需关注），较差为红色（需尽快处理）。
 */
const healthDotColor = computed(() => {
  switch (props.healthGrade) {
    case 'poor':
      return '#f56c6c';
    case 'fair':
      return '#e6a23c';
    default:
      return '#67c23a';
  }
});

/**
 * 单库档位 → 该库的状态文案
 *
 * `stale` 与 `ok` 都带天数，区别在颜色与「未 / 已」两个字的语义，不靠颜色单独表达状态。
 */
const vaultStateText = (detail: BackupVaultChipDetail): string => {
  switch (detail.verdict) {
    case 'never':
      return t('options.header.backupChipNever');
    case 'pending':
      return t('options.header.backupChipPending');
    case 'stale':
      return t('options.header.backupChipStale', { days: detail.ageDays ?? 0 });
    case 'ok':
      return (detail.ageDays ?? 0) <= 0
        ? t('options.header.backupChipToday')
        : t('options.header.backupChipDays', { days: detail.ageDays ?? 0 });
    default:
      return t('options.header.backupChipEmpty');
  }
};

/** 徽标可见文字：取最差库的状态 */
const backupChipText = computed(() => {
  const chip = props.backupChip;
  const state = vaultStateText(chip.perVault[chip.worstVault]);
  // 最差库不是默认被读到的「密码库」时才补库名标签——否则「个人信息库从未备份」
  // 会被读成整库都没备份，而反过来一库绿一库红时，徽标也必须说清红在哪。
  if (chip.worstVault === 'identity' && chip.perVault.identity.verdict !== chip.perVault.passwords.verdict) {
    return `${t('options.header.backupChipIdentityTag')} · ${state}`;
  }
  return state;
});

/** 徽标 `title` 与 `aria-label`：两库各自陈述，空库也写出来，不让徽标替它报平安 */
const backupChipDetail = computed(() =>
  [
    t('options.header.backupChipVaultState', {
      vault: t('options.header.backupChipPasswordsLabel'),
      state: vaultStateText(props.backupChip.perVault.passwords),
    }),
    t('options.header.backupChipVaultState', {
      vault: t('options.header.backupChipIdentityLabel'),
      state: vaultStateText(props.backupChip.perVault.identity),
    }),
  ].join(' · '),
);
</script>

<style scoped>
.header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 32px;
  margin-bottom: 24px;
  color: white;
  background: linear-gradient(135deg, var(--aph-primary) 0%, var(--aph-primary-hover) 100%);
  border-radius: 0;
  box-shadow: 0 2px 12px rgb(var(--aph-primary-rgb) / 15%);
}

.header-title-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

/* 状态区：备份徽标 + 会话徽标 + 一键锁定，同一视觉域内相邻，窄屏一起换行而不挤压标题 */
.header-status {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  align-items: center;
}

/* 备份徽标：与会话徽标同族的半透明 chip，四档颜色由 level 类名切换。
   与会话徽标的关键差别是**不脉冲**——它表达的是天级状态，常驻动画只会变成噪音；
   只有 `critical`（从未备份）允许一次轻呼吸，且随 reduced-motion 关闭。
   档位同时改文字（从未备份 / 待备份 / N 天未备份 / N 天前已备份），颜色不是唯一通道。 */
.backup-chip {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(255 255 255 / 90%);
  cursor: pointer;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 999px;
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

.backup-chip:hover {
  background: rgb(255 255 255 / 22%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

.backup-chip:focus-visible {
  outline: 2px solid rgb(255 255 255 / 70%);
  outline-offset: 2px;
}

.backup-chip .el-icon {
  font-size: 14px;
}

.backup-chip__text {
  font-variant-numeric: tabular-nums;
}

/* 状态灯三档色。取值全部来自本文件既有先例，不新造调色板：
   - `ok` 绿用会话徽标状态灯的 #86efac（同一枚半透明蓝底 chip 上，#67c23a 那种中绿会被
     背景吃掉、和紧邻的会话绿灯明显不同族）；
   - `warning` 橙保留 #e6a23c 但加一圈体检圆点同款的白色描边，让它在渐变蓝上分得开；
   - `urgent` / `critical` 直接把整枚 chip 换成橙底 / 红底，状态灯转为纯白点。 */
.backup-chip__dot {
  width: 6px;
  height: 6px;
  background: #86efac;
  border-radius: 50%;
  box-shadow: 0 0 6px 1px rgb(134 239 172 / 60%);
}

.backup-chip--warning .backup-chip__dot {
  background: #e6a23c;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 35%);
}

/* 紧迫与危急两档改整枚 chip 的底色，必须写在 `--warning` 之后以覆盖同名属性 */
.backup-chip--urgent {
  color: #fff;
  background: rgb(230 162 60 / 85%);
  border-color: rgb(255 255 255 / 45%);
}

.backup-chip--urgent .backup-chip__dot {
  background: #fff;
  box-shadow: none;
}

.backup-chip--critical {
  color: #fff;
  background: rgb(245 108 108 / 85%);
  border-color: rgb(255 255 255 / 45%);
  animation: backup-chip-breathe 3s ease-in-out infinite;
}

.backup-chip--critical .backup-chip__dot {
  background: #fff;
  box-shadow: none;
}

@keyframes backup-chip-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(245 108 108 / 35%);
  }

  50% {
    box-shadow: 0 0 0 5px rgb(245 108 108 / 0%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .backup-chip--critical {
    animation: none;
  }
}

.header-title h1 {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 24px;
  font-weight: 500;
  color: white;
}

.header-title .logo {
  margin-right: 12px;
  font-size: 28px;
  color: #fff;
}

/* 版本号链接：弱化的可点击徽标，hover 提亮反馈，不争夺标题注意力 */
.header-title .version-tag-link {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: 10px;
  text-decoration: none;
  border-radius: 4px;
}

.header-title .version-tag-link:hover .version-tag {
  color: #fff;
  background: rgb(255 255 255 / 28%);
}

.header-title .version-tag-link:focus-visible {
  outline: 2px solid rgb(255 255 255 / 80%);
  outline-offset: 1px;
}

.header-title .version-tag {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: rgb(255 255 255 / 70%);
  cursor: pointer;
  user-select: none;
  background: rgb(255 255 255 / 15%);
  border-color: rgb(255 255 255 / 20%);
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.header-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  width: 100%;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* 右侧辅助入口：贴右排布；左组换行导致整行放不下时，本组整体换到下一行右侧，
   而非停留在行内垂直居中位置造成基线错位 */
.header-actions-right {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: flex-end;
  max-width: 100%;
  margin-left: auto;
}

/* 工具条行内间距的唯一真源是上面两条 `gap: 12px`，此处抵消 Element Plus 的
   `.el-button + .el-button { margin-left: 12px }`（2.14.4 index.css，特异性 (0,2,0)）。
   它按「相邻兄弟恰好都是 .el-button」命中，而本行两组结构并不一致：左组只有
   「添加密码→安全体检→个人信息库」这一段是直接相邻的按钮，「数据管理」「安全设置」
   「偏好设置」的按钮包在 `.el-dropdown` 里或紧随其后、`+` 命中情况各不相同；右组
   则是「直接按钮 + 下拉包裹」的混合。与 SearchFilterBar / TrashDialog / SidepanelAuthView
   同一处理方式，由 tests/architecture/headerToolbarDensity.test.ts 守卫两侧同值 */
.header-actions :deep(.el-button + .el-button),
.header-actions-right :deep(.el-button + .el-button) {
  margin-left: 0;
}

/* 安全体检小圆点：一眼可见的健康信号灯 */
.health-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  vertical-align: middle;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 35%);
}

/* 命令面板按钮内的快捷键键帽：与版本徽标同族的「弱化的可点击线索」，
   不额外抢注意力，但让 Ctrl/Cmd+K 在鼠标悬停之前就能被看见 */
.cp-kbd {
  padding: 0 5px;
  margin-left: 6px;
  font-size: 11px;
  line-height: 16px;
  color: rgb(255 255 255 / 88%);
  background: rgb(255 255 255 / 14%);
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 4px;
}

/* 会话剩余时间徽标：半透明 chip，与头部渐变背景融合；点击直达有效期设置。
   结构为「呼吸状态灯 + 计时图标 + 等宽数字」：状态灯表达会话存活，
   数字用 tabular-nums 避免逐秒跳动引起宽度抖动 */
.session-chip {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(255 255 255 / 90%);
  cursor: pointer;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 999px;
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

.session-chip:hover {
  background: rgb(255 255 255 / 22%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

.session-chip:focus-visible {
  outline: 2px solid rgb(255 255 255 / 70%);
  outline-offset: 2px;
}

.session-chip .el-icon {
  font-size: 14px;
}

.session-chip__time {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* 会话存活状态灯：柔和绿光晕，紧迫态转白并伴随扩散脉冲 */
.session-chip__pulse {
  width: 6px;
  height: 6px;
  background: #86efac;
  border-radius: 50%;
  box-shadow: 0 0 6px 1px rgb(134 239 172 / 60%);
}

/* 紧迫态（≤10 分钟）：转警示橙，轻脈动吸引注意但不干扰 */
.session-chip--urgent {
  color: #fff;
  background: rgb(230 162 60 / 85%);
  border-color: rgb(255 255 255 / 45%);
  animation: session-chip-pulse 2s ease-in-out infinite;
}

.session-chip--urgent .session-chip__pulse {
  background: #fff;
  box-shadow: none;
  animation: session-dot-pulse 1.2s ease-out infinite;
}

/* 危急态（≤1 分钟）：转警示红，脉冲加快强化紧迫感；需写在紧迫态之后以覆盖同名属性 */
.session-chip--critical {
  background: rgb(245 108 108 / 85%);
  animation: session-chip-pulse-critical 1.2s ease-in-out infinite;
}

@keyframes session-dot-pulse {
  0% {
    box-shadow: 0 0 0 0 rgb(255 255 255 / 60%);
  }

  100% {
    box-shadow: 0 0 0 6px rgb(255 255 255 / 0%);
  }
}

@keyframes session-chip-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(230 162 60 / 45%);
  }

  50% {
    box-shadow: 0 0 0 5px rgb(230 162 60 / 0%);
  }
}

@keyframes session-chip-pulse-critical {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(245 108 108 / 50%);
  }

  50% {
    box-shadow: 0 0 0 5px rgb(245 108 108 / 0%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-chip--urgent,
  .session-chip--critical,
  .session-chip--urgent .session-chip__pulse {
    animation: none;
  }
}

/* 一键锁定：与会话徽标同族的玻璃态按钮，但保留原生按钮语义（可聚焦、可回车、可回填 loading） */
:deep(.header-status .el-button.lock-btn) {
  font-weight: 400;
  color: white;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

:deep(.header-status .el-button.lock-btn:hover) {
  background: rgb(255 255 255 / 22%);
  border-color: rgb(255 255 255 / 45%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

/* 下拉菜单触发按钮样式 */
:deep(.header-actions .el-dropdown .el-button) {
  font-weight: 400;
  color: white;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

:deep(.header-actions .el-dropdown .el-button:hover) {
  background: rgb(255 255 255 / 20%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

:deep(.header-actions .el-dropdown .el-button .el-icon--right) {
  margin-left: 4px;
}

:deep(.header-actions .el-button) {
  font-weight: 400;
  color: white;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

:deep(.header-actions .el-button:hover) {
  background: rgb(255 255 255 / 20%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

:deep(.header-actions .el-button--primary) {
  font-weight: 500;
  color: var(--aph-primary);
  background: #fff;
  border: 1px solid #fff;
}

:deep(.header-actions .el-button--primary:hover) {
  color: var(--aph-primary);
  background: var(--aph-surface-hover);
  border-color: var(--aph-surface-hover);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

/* 右侧工具区（命令面板 / 帮助）：玻璃态，与左组的下拉触发按钮同族。
   帮助那颗包在 `.el-dropdown` 里，直接子选择器命中不到它，必须单独覆盖，
   否则同一行上会出现两种不同质地的按钮 */
:deep(.header-actions-right > .el-button),
:deep(.header-actions-right .el-dropdown .el-button) {
  font-weight: 400;
  color: white;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

:deep(.header-actions-right > .el-button:hover),
:deep(.header-actions-right .el-dropdown .el-button:hover) {
  background: rgb(255 255 255 / 20%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

/* 已验证备份状态条已随菜单项一起下线（状态上移到头部徽标），此处不再保留样式 */

/* 响应式 */
@media (width <= 768px) {
  .header {
    padding: 20px;
  }

  .header-title h1 {
    font-size: 20px;
  }

  .header-actions {
    justify-content: center;
    width: 100%;
  }

  .header-actions-row {
    justify-content: center;
  }
}
</style>
