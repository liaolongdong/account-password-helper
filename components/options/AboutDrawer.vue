<template>
  <el-drawer
    :model-value="modelValue"
    :title="t('options.about.title')"
    direction="rtl"
    size="400px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="about">
      <!-- 品牌与版本：版本号在此只作展示，升级入口在下方「最新版本与下载」 -->
      <div class="about__brand">
        <!--
          这里用打包内的真实扩展图标，而不是复用 `BrandLogo.vue`：
          `BrandLogo` 同时被 Options 与侧边栏的**首屏**引用，抽屉却是异步 chunk，
          一个模块被「首屏 + 按需」两侧共同引用时会被拆成独立 chunk，于是
          popup / sidepanel 的 eager 预加载各多出一个文件——实测 popup 由 43 涨到 44，
          直接被 `tests/architecture/sidepanelClosure.test.ts` 判红。为了一个装饰性
          logo 放宽守着侧边栏秒开 SLA 的预算，方向反了；图标本来就是产物里的
          `public/icon/`，按 3 倍图给 32px 落位，零模块图影响。
        -->
        <img
          class="about__logo"
          src="/icon/96.png"
          width="32"
          height="32"
          alt=""
        />
        <div class="about__brand-text">
          <span class="about__name">{{ t('appName') }}</span>
          <el-tag
            size="small"
            type="info"
            class="about__version"
          >
            v{{ version }}
          </el-tag>
        </div>
      </div>

      <p class="about__summary">
        {{ t('options.about.summary') }}
      </p>

      <!--
        核心能力：口径取自 README「核心优势」里已在对外承诺的那几条，逐条都能在本仓找到实现，
        不在此另起一套说法（对外文案与产品内文案漂移，用户读到的是两个产品）。
        用小标题而非 el-divider：divider 自带 24px 上下外边距，会把摘要与清单之间撑开，
        与本抽屉「标题贴内容」的排布相反。
      -->
      <p class="about__section">{{ t('options.about.featuresTitle') }}</p>

      <ul class="about__features">
        <li
          v-for="feature in features"
          :key="feature"
        >
          {{ feature }}
        </li>
      </ul>

      <!-- 安全与网络事实：与 privacy.html / llms.txt 已公开的口径一致，不在此另起说法 -->
      <dl class="about__facts">
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="about__fact"
        >
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>

      <el-divider content-position="left">
        {{ t('options.about.linksTitle') }}
      </el-divider>

      <!--
        外链逐条写出而非动态组件渲染图标：`<component :is>` 会让 Element Plus 按需引入
        退化成整包图标，与本仓「禁止整包导入」的约定相违。
        目标主机名一并展示——密码管理器的「关于」页里，"点这条会去哪儿"应当是可见事实。
      -->
      <ul class="about-links">
        <li
          v-for="link in links"
          :key="link.href"
        >
          <a
            :href="link.href"
            class="about-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="about-link__label">{{ link.label }}</span>
            <span class="about-link__host">{{ link.host }}</span>
            <el-icon
              class="about-link__icon"
              aria-hidden="true"
            >
              <TopRight />
            </el-icon>
          </a>
        </li>
      </ul>

      <p class="about__license">
        {{ t('options.about.license') }}
      </p>
    </div>

    <template #footer>
      <div class="about-footer">
        <el-button
          v-if="!isFirefox"
          :icon="Star"
          @click="$emit('review')"
        >
          {{ t('options.about.review') }}
        </el-button>
        <el-button
          v-if="!isFirefox"
          :icon="Share"
          @click="handleShare"
        >
          {{ t('options.about.share') }}
        </el-button>
        <el-button @click="$emit('update:modelValue', false)">{{ t('common.close') }}</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { Share, Star, TopRight } from '@element-plus/icons-vue';
import { copyTextToClipboard } from '@/utils/clipboard';
import { isFirefox } from '@/utils/env';
import { useI18n } from '@/utils/i18n';
import {
  AUTHOR_PAGE_URL,
  AUTHOR_PAGE_URL_EN,
  CHROME_WEB_STORE_URL,
  GITHUB_RELEASES_PAGE_URL,
  PRIVACY_POLICY_URL,
  PRIVACY_POLICY_URL_EN,
  PRODUCT_DOCS_URL,
  REPO_GITHUB_URL,
  REPO_ISSUES_URL,
  REPO_LICENSE_URL,
  TEAMMATE_PRODUCT_URL,
  TEAMMATE_SHARE_URL,
} from '@/utils/urls';

/**
 * 「关于」抽屉
 *
 * 把散落在源码注释与商店后台的对外事实收在一处：版本、这份扩展做什么、数据存在哪、
 * 加密用什么、插件会发出哪几个网络请求，以及仓库 / 商店 / 文档 / 隐私 / 反馈的出口。
 * 纯展示组件：不读存储、不发请求、不碰加密与会话，链接一律是新标签页打开的静态地址，
 * 全部地址取自 `utils/urls.ts` 的单一真源（避免同一地址在插件与商店两侧各自漂移）。
 *
 * Chrome 应用商店那一行按构建目标隐藏：Firefox 构建里这条链接既打不开也不该出现在
 * 一个密码管理器的界面上。隐私政策按界面语言选中英两份之一——那两份文档必须与商店后台
 * 填的 URL 同源，因此这里只做「选哪一条」，不拼接地址。
 */
defineProps<{
  /** 抽屉显隐状态 */
  modelValue: boolean;
  /** 当前插件版本号（与头部版本徽标同源，由父级传入） */
  version: string;
}>();

defineEmits<{
  'update:modelValue': [boolean];
  /** 打开 Chrome 应用商店评价页；由父级负责外链与一次性引导状态 */
  review: [];
}>();

const { t, currentLocale } = useI18n();

/** 一条对外出口 */
interface AboutLink {
  /** 目标地址 */
  href: string;
  /** 行的说明文案 */
  label: string;
  /** 目标主机名（从 href 取，不另写一遍，避免两处漂移） */
  host: string;
}

/**
 * 取 href 的主机名
 *
 * 入参全部是本模块内的字面量常量，不存在解析失败的路径，故不做兜底分支。
 */
const hostOf = (href: string): string => new URL(href).host;

/** 对外出口清单 */
const links = computed<AboutLink[]>(() => {
  const items: AboutLink[] = [
    { href: PRODUCT_DOCS_URL, label: t('options.about.linkDocs') },
    {
      href: currentLocale.value === 'en' ? AUTHOR_PAGE_URL_EN : AUTHOR_PAGE_URL,
      label: t('options.about.linkAuthor'),
    },
    {
      href: currentLocale.value === 'en' ? PRIVACY_POLICY_URL_EN : PRIVACY_POLICY_URL,
      label: t('options.about.linkPrivacy'),
    },
    { href: REPO_GITHUB_URL, label: t('options.about.linkRepo') },
    { href: REPO_LICENSE_URL, label: t('options.about.linkLicense') },
    { href: GITHUB_RELEASES_PAGE_URL, label: t('options.about.linkReleases') },
  ];
  // Firefox 构建没有 Chrome 商店条目可去
  if (!isFirefox) {
    items.push({ href: CHROME_WEB_STORE_URL, label: t('options.about.linkStore') });
  }
  items.push({ href: REPO_ISSUES_URL, label: t('options.about.linkIssues') });
  return items.map(item => ({ ...item, host: hostOf(item.href) }));
});

/** 安全与网络事实（标签短、值长，左右排布避免撑出横向滚动） */
const facts = computed(() => [
  { label: t('options.about.factStorage'), value: t('options.about.factStorageValue') },
  { label: t('options.about.factCrypto'), value: t('options.about.factCryptoValue') },
  { label: t('options.about.factNetwork'), value: t('options.about.factNetworkValue') },
]);

/** 核心能力清单（一句话一条；顺序按「用户多久碰到一次」排，两步验证最先） */
const features = computed(() => [
  t('options.about.featureTotp'),
  t('options.about.featureDomain'),
  t('options.about.featureHealth'),
  t('options.about.featureTransfer'),
  t('options.about.featurePanel'),
]);

/** 复制一段不含任何凭据的同事分享文案；产品页与商店链接同一组 UTM，便于归因 */
const handleShare = async (): Promise<void> => {
  const ok = await copyTextToClipboard(
    t('options.about.shareText', {
      productUrl: TEAMMATE_PRODUCT_URL,
      storeUrl: TEAMMATE_SHARE_URL,
    }),
  );
  if (ok) ElMessage.success(t('options.about.shareCopied'));
  else ElMessage.error(t('options.about.shareFailed'));
};
</script>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.about__brand {
  display: flex;
  gap: 12px;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--aph-surface-line);
}

.about__logo {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
}

.about__brand-text {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.about__name {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.about__summary {
  margin: 16px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

/* 小节标题：与事实清单的 dt 同一套量级，但它是「能力清单」的引导句，紧贴清单 */
.about__section {
  margin: 12px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.about__features {
  padding: 0 0 0 18px;
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  list-style: disc;
}

.about__features li + li {
  margin-top: 2px;
}

/* 事实清单：标签在上、值在下 */
.about__facts {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  margin: 0;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

/*
 * 不用「左标签右值」的两列排布：英文标签最长有 18 字符（Where it is stored），
 * 与值并排会把值列压到约 246px，那条讲 PBKDF2 与 AES 的值要折 5 行，而中文只折 3 行——
 * 同一份事实在两种语言里行数不同、且英文更挤。竖排后值独占整幅宽度，中英读到的形状一致。
 */
.about__fact {
  display: block;
}

.about__fact dt {
  margin-bottom: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.about__fact dd {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  overflow-wrap: anywhere;
}

.about-links {
  padding: 0;
  margin: 0;
  list-style: none;
}

.about-link {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 8px 4px;
  color: var(--el-text-color-regular);
  text-decoration: none;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.about-link:hover {
  background: var(--aph-surface-hover);
}

.about-link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.about-link__label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--aph-primary-strong);
}

.about-link__host {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: right;
  overflow-wrap: anywhere;
}

.about-link__icon {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.about__license {
  margin: 16px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.about-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

/*
 * 三按钮走 el-button 默认档（14px / 32px），不用 `size="small"`：全仓 Options 的 footer 只有这里
 * 曾是 small，12px 也是整个抽屉里最小的字号，却落在「去评价」「分享给同事」这两个关键转化点上；
 * 24px 高度又正好压在 WCAG 2.5.8 的下限上零余量。
 * 档位是拿**英文态文案宽度**换的：400px 抽屉的 footer 可用宽 368px，默认档 + 长文案
 * "Share with a teammate" 实测需 383.36px，会把三按钮挤成两行（e2e 有「三按钮同行」的几何断言），
 * 故 EN 标签缩成 "Share"（zh 仍是「分享给同事」），缩后 270.31px。
 * 间距保持 6px 而**不跟弹窗 footer 的 12px 同档**：400px 抽屉要塞下三颗带图标按钮，且这个收紧
 * 是既有决定，由 e2e/command-palette.spec.ts 的「间距 ≤8px」几何断言钉住。
 * 无论取哪一档，容器 `gap` 都是唯一真源，故必须接管 Element Plus 默认的 12px 相邻按钮边距，
 * 否则两者叠加成 18px。
 */
.about-footer :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
