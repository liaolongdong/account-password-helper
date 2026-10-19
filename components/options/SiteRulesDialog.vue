<template>
  <!-- 720px 是列表四列的地板：弹窗左右各 16px padding + 滚动容器 4px padding-right，
       表格可用宽度 = 720 − 36 = 684 ≥ 160+260+110+130 = 660；再窄一格表格就会横向滚动。 -->
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="720px"
    align-center
    class="site-rules-dialog"
    @closed="handleClosed"
  >
    <div class="dialog-body-scroll">
      <!-- 列表视图 -->
      <div
        v-if="!showForm"
        class="rules-view"
      >
        <el-table
          v-if="rulesList.length"
          :data="rulesList"
          :tooltip-options="TABLE_OVERFLOW_TOOLTIP_OPTIONS"
          border
          max-height="360"
        >
          <el-table-column
            prop="domain"
            :label="t('options.siteRules.columnDomain')"
            min-width="160"
            show-overflow-tooltip
          />
          <el-table-column
            :label="t('options.siteRules.columnSelectors')"
            min-width="260"
          >
            <template #default="{ row }">
              <div
                v-if="row.customSelectors"
                class="selector-cell"
              >
                <div class="selector-line">
                  <span class="selector-tag">{{ t('options.siteRules.labelUsername') }}</span>
                  <code :title="row.customSelectors.username">{{ row.customSelectors.username }}</code>
                </div>
                <div class="selector-line">
                  <span class="selector-tag">{{ t('options.siteRules.labelPassword') }}</span>
                  <code :title="row.customSelectors.password">{{ row.customSelectors.password }}</code>
                </div>
              </div>
              <span
                v-else
                class="text-gray"
              >
                {{ t('options.siteRules.noSelectors') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('options.siteRules.columnFillEntry')"
            width="110"
            align="center"
          >
            <template #default="{ row }">
              <span
                v-if="row.fillEntry"
                class="fill-entry-tag"
              >
                {{ fillEntryLabel(row.fillEntry) }}
              </span>
              <span
                v-else
                class="text-gray"
              >
                {{ t('options.siteRules.fillFollowGlobal') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column
            :label="t('options.siteRules.columnActions')"
            width="130"
            align="center"
          >
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                @click="handleEdit(row)"
              >
                {{ t('options.siteRules.edit') }}
              </el-button>
              <el-button
                link
                type="danger"
                @click="handleDelete(row)"
              >
                {{ t('options.siteRules.delete') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-empty
          v-else
          :image-size="80"
          :description="t('options.siteRules.empty')"
        >
          <div class="empty-tip">{{ t('options.siteRules.emptyTip') }}</div>
        </el-empty>

        <div class="transfer-tip">{{ t('options.siteRules.transferHint') }}</div>
      </div>

      <!-- 表单视图（新增 / 编辑） -->
      <el-form
        v-else
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-position="top"
        class="site-rules-form"
      >
        <el-alert
          :title="t('options.siteRules.formHint')"
          type="info"
          :closable="false"
          show-icon
          class="form-hint"
        />

        <el-form-item
          :label="t('options.siteRules.formDomain')"
          :required="!isEditing"
          prop="domain"
        >
          <!-- 域名即规则主键，编辑态不可改。用 readonly 而非 disabled（disabled 会把域名
               文字压到 2.3:1 且无法选中复制），锁定外观由下方 .domain-input--locked 负责 -->
          <el-input
            v-model="formData.domain"
            :readonly="isEditing"
            :disabled="!!pickingField"
            :class="{ 'domain-input--locked': isEditing }"
            :placeholder="t('options.siteRules.formDomainPlaceholder')"
            :clearable="!isEditing"
          >
            <template
              v-if="isEditing"
              #suffix
            >
              <el-icon class="domain-lock"><Lock /></el-icon>
            </template>
          </el-input>
          <div class="field-tip">
            {{ isEditing ? t('options.siteRules.domainReadonlyHint') : t('options.siteRules.formDomainHint') }}
          </div>
        </el-form-item>

        <el-form-item
          :label="t('options.siteRules.formFillEntry')"
          prop="fillEntry"
        >
          <el-select
            v-model="formData.fillEntry"
            class="fill-entry-select"
          >
            <el-option
              :value="FOLLOW_GLOBAL"
              :label="t('options.siteRules.fillFollowGlobal')"
            />
            <el-option
              value="sidepanel"
              :label="t('options.siteRules.fillSidepanel')"
            />
            <el-option
              value="inline"
              :label="t('options.siteRules.fillInline')"
            />
            <el-option
              value="manual"
              :label="t('options.siteRules.fillManual')"
            />
          </el-select>
          <div class="field-tip">{{ t('options.siteRules.fillEntryHint') }}</div>
        </el-form-item>

        <el-form-item
          :label="t('options.siteRules.formUsernameSelector')"
          prop="usernameSelector"
        >
          <div class="selector-field-row">
            <el-input
              v-model="formData.usernameSelector"
              class="selector-field-input"
              :placeholder="t('options.siteRules.formUsernamePlaceholder')"
              clearable
              @input="revalidateSelectorPair"
            />
            <el-button
              class="selector-pick-button"
              :icon="Aim"
              :loading="pickingField === 'username'"
              :disabled="!!pickingField && pickingField !== 'username'"
              :title="t('options.siteRules.pickUsername')"
              :aria-label="t('options.siteRules.pickUsername')"
              @click="startPick('username')"
            >
              {{ t('options.siteRules.pick') }}
            </el-button>
          </div>
        </el-form-item>

        <el-form-item
          :label="t('options.siteRules.formPasswordSelector')"
          prop="passwordSelector"
        >
          <div class="selector-field-row">
            <el-input
              v-model="formData.passwordSelector"
              class="selector-field-input"
              :placeholder="t('options.siteRules.formPasswordPlaceholder')"
              clearable
              @input="revalidateSelectorPair"
            />
            <el-button
              class="selector-pick-button"
              :icon="Aim"
              :loading="pickingField === 'password'"
              :disabled="!!pickingField && pickingField !== 'password'"
              :title="t('options.siteRules.pickPassword')"
              :aria-label="t('options.siteRules.pickPassword')"
              @click="startPick('password')"
            >
              {{ t('options.siteRules.pick') }}
            </el-button>
          </div>
          <div
            class="field-tip picker-tip"
            aria-live="polite"
          >
            {{
              pickingField
                ? t('options.siteRules.pickActiveHint', {
                    field:
                      pickingField === 'username'
                        ? t('options.siteRules.labelUsername')
                        : t('options.siteRules.labelPassword'),
                  })
                : t('options.siteRules.pickHint')
            }}
          </div>
        </el-form-item>

        <el-form-item
          :label="t('options.siteRules.formPenetrateShadow')"
          label-position="left"
          class="penetrate-item"
        >
          <el-switch v-model="formData.penetrateShadow" />
        </el-form-item>
        <!-- 提示语必须是 form-item 的兄弟块而不是插槽内容：这一行为了紧凑把标签放在左侧，
             el-form-item 随之变成 flex 行，内容列只剩「弹窗宽度 - 标签宽度」（实测 684 − 181），
             放在里面的提示语会跟着标签缩进，与上方两条 top 标签字段的提示语左边界不齐 -->
        <div class="field-tip penetrate-tip">{{ t('options.siteRules.penetrateShadowHint') }}</div>
      </el-form>
    </div>

    <template #footer>
      <!-- 表单态：提交/取消；列表态：导入/导出 + 「添加规则」（空态亦复用此处，避免与空状态内按钮重复） -->
      <template v-if="showForm">
        <el-button @click="cancelForm">
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!!pickingField"
          @click="handleSubmit"
        >
          {{ t('common.save') }}
        </el-button>
      </template>
      <template v-else>
        <el-button
          :icon="Upload"
          :loading="importing"
          @click="pickImportFile"
        >
          {{ t('options.siteRules.importButton') }}
        </el-button>
        <el-button
          :icon="Download"
          :loading="exporting"
          :disabled="!rulesList.length"
          @click="handleExport"
        >
          {{ t('options.siteRules.exportButton') }}
        </el-button>
        <el-button
          type="primary"
          :icon="Plus"
          @click="handleAdd"
        >
          {{ t('options.siteRules.addButton') }}
        </el-button>
        <!-- 原生 file input 只做取文件，校验与合并全在 utils/siteRulesTransfer -->
        <input
          ref="fileInputRef"
          type="file"
          accept="application/json,.json"
          class="import-file-input"
          @change="handleImportFile"
        />
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, ElForm } from 'element-plus';
import { Plus, Lock, Download, Upload, Aim } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';
import {
  MessageType,
  type FillEntry,
  type SelectorPickedData,
  type SelectorPickCancelledData,
  type StartSelectorPickResponse,
} from '@/utils/types';
import { TABLE_OVERFLOW_TOOLTIP_OPTIONS } from '@/utils/tableOverflowTooltip';
import { logger } from '@/utils/logger';
import {
  getSiteRules,
  setSiteRule,
  removeSiteRule,
  isValidCssSelector,
  normalizeSiteRuleDomain,
  type SiteRule,
} from '@/utils/storage/siteRules';
import {
  exportSiteRulesToFile,
  getSiteRulesImportErrorCode,
  importSiteRulesFromText,
  SITE_RULES_IMPORT_MAX_INPUT_BYTES,
  SITE_RULES_IMPORT_MAX_RULES,
  type SiteRulesImportErrorCode,
} from '@/utils/siteRulesTransfer';

const props = defineProps<{
  modelValue: boolean;
  /** 打开时预填的域名（来自内容脚本填充失败引导）；该域名已有规则时直接进入编辑表单 */
  initialDomain?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
});

const formRef = ref<InstanceType<typeof ElForm>>();
const fileInputRef = ref<HTMLInputElement>();
const rulesList = ref<SiteRule[]>([]);
const showForm = ref(false);
const editingRule = ref<SiteRule | null>(null);
const saving = ref(false);
const exporting = ref(false);
const importing = ref(false);

type PickField = 'username' | 'password';

/** 正在拾取的字段；null 表示拾取器未运行 */
const pickingField = ref<PickField | null>(null);
const pickRequestId = ref('');
let pickTabId: number | undefined;
let pickTimeout: ReturnType<typeof setTimeout> | null = null;
let pickDomain = '';

const runtimeAvailable = (): boolean =>
  typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';

const clearPickState = (): void => {
  if (pickTimeout) {
    clearTimeout(pickTimeout);
    pickTimeout = null;
  }
  pickingField.value = null;
  pickRequestId.value = '';
  pickTabId = undefined;
  pickDomain = '';
};

/** 取消仍在目标页运行的拾取器；无论消息是否送达都先清本地状态，避免表单被锁住 */
const cancelActivePick = (): void => {
  const requestId = pickRequestId.value;
  const tabId = pickTabId;
  clearPickState();
  if (!requestId || !runtimeAvailable()) return;
  try {
    void chrome.runtime
      .sendMessage({ type: MessageType.CANCEL_SELECTOR_PICK, data: { tabId, requestId } })
      .catch(() => {});
  } catch {
    /* 扩展上下文已失效时没有可清理的页面 */
  }
};

let optionsTabId: number | undefined;

/** 拾取完成后把管理页切回前台，用户不必再手动找回来 */
const activateOptionsTab = async (): Promise<void> => {
  if (optionsTabId === undefined || !runtimeAvailable()) return;
  try {
    const tab = await chrome.tabs.get(optionsTabId);
    await chrome.tabs.update(optionsTabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    /* 管理页可能已被关闭；结果仍会留在内存状态里，没有可切回的页面 */
  }
};

/** 启动拾取：背景会切到同域名的已打开标签页，用户点一下输入框即可回填 */
const startPick = async (field: PickField): Promise<void> => {
  if (pickingField.value) return;
  const domain = normalizeSiteRuleDomain(formData.domain);
  if (!domain) {
    const validation = formRef.value?.validateField('domain');
    if (validation) void validation.catch(() => {});
    ElMessage.warning(t('options.siteRules.pickDomainRequired'));
    return;
  }
  if (!runtimeAvailable()) {
    ElMessage.error(t('options.siteRules.pickFailed'));
    return;
  }

  pickingField.value = field;
  pickDomain = domain;
  pickRequestId.value =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requestId = pickRequestId.value;
  pickTimeout = setTimeout(() => {
    if (!pickingField.value || pickRequestId.value !== requestId) return;
    // 超时不只是关本地状态：目标页上的拾取覆盖层也要撤掉
    cancelActivePick();
    ElMessage.warning(t('options.siteRules.pickTimeout'));
    void activateOptionsTab();
  }, 120_000);

  try {
    const response = (await chrome.runtime.sendMessage({
      type: MessageType.START_SELECTOR_PICK,
      data: { domain, field, requestId },
    })) as StartSelectorPickResponse | undefined;

    // 等待回包期间可能已超时 / 取消 / 切换了请求：旧响应不得重新点亮表单状态
    if (pickRequestId.value !== requestId || pickingField.value !== field) {
      if (response?.success && response.tabId !== undefined) {
        try {
          void chrome.runtime
            .sendMessage({ type: MessageType.CANCEL_SELECTOR_PICK, data: { tabId: response.tabId, requestId } })
            .catch(() => {});
        } catch {
          /* 扩展上下文失效时没有可取消的页面 */
        }
      }
      return;
    }

    if (!response?.success) {
      clearPickState();
      if (response?.error === 'NO_TAB') {
        ElMessage.warning(t('options.siteRules.pickNoTab', { domain }));
      } else if (response?.error === 'NO_CONTENT_SCRIPT') {
        ElMessage.warning(t('options.siteRules.pickNoContentScript'));
      } else {
        ElMessage.error(t('options.siteRules.pickFailed'));
      }
      return;
    }
    pickTabId = response.tabId;
    ElMessage.info(t('options.siteRules.pickStarted'));
  } catch (error) {
    logger.error('启动选择器拾取失败:', error);
    clearPickState();
    ElMessage.error(t('options.siteRules.pickFailed'));
  }
};

/** 接收 Background 广播的拾取结果 / 取消回执 */
const handleSelectorPickMessage = (message: unknown): void => {
  if (!pickingField.value) return;
  const msg = message as {
    type?: string;
    data?: Partial<SelectorPickedData> & Partial<SelectorPickCancelledData>;
  };
  if (msg.type === MessageType.SELECTOR_PICKED) {
    const data = msg.data as Partial<SelectorPickedData> | undefined;
    if (
      !data ||
      data.requestId !== pickRequestId.value ||
      data.field !== pickingField.value ||
      (data.domain && data.domain !== pickDomain)
    ) {
      return;
    }
    const selector = typeof data.selector === 'string' ? data.selector.trim() : '';
    if (!selector || !isValidCssSelector(selector)) {
      clearPickState();
      ElMessage.error(t('options.siteRules.pickInvalid'));
      void activateOptionsTab();
      return;
    }
    const field = pickingField.value;
    if (field === 'username') formData.usernameSelector = selector;
    else formData.passwordSelector = selector;
    clearPickState();
    revalidateSelectorPair();
    if (data.unique === false) ElMessage.warning(t('options.siteRules.pickNotUnique'));
    else ElMessage.success(t('options.siteRules.pickSuccess'));
    void activateOptionsTab();
    return;
  }
  if (msg.type === MessageType.SELECTOR_PICK_CANCELLED) {
    const data = msg.data as Partial<SelectorPickCancelledData> | undefined;
    if (!data || data.requestId !== pickRequestId.value) return;
    clearPickState();
    ElMessage.info(t('options.siteRules.pickCancelled'));
    void activateOptionsTab();
  }
};

onMounted(() => {
  if (runtimeAvailable()) {
    chrome.runtime.onMessage.addListener(handleSelectorPickMessage);
    void chrome.tabs
      .getCurrent()
      .then(tab => {
        optionsTabId = tab?.id;
      })
      .catch(() => {});
  }
});

onBeforeUnmount(() => {
  if (runtimeAvailable()) chrome.runtime.onMessage.removeListener(handleSelectorPickMessage);
  cancelActivePick();
});

/** 导入错误码 → 可读文案；原始异常只进日志，不直接抛给用户 */
const IMPORT_ERROR_KEYS: Record<SiteRulesImportErrorCode, string> = {
  FILE_TOO_LARGE: 'options.siteRules.importErrorFileTooLarge',
  INVALID_JSON: 'options.siteRules.importErrorInvalidJson',
  UNSUPPORTED_FILE: 'options.siteRules.importErrorUnsupportedFile',
  TOO_MANY_RULES: 'options.siteRules.importErrorTooManyRules',
  NO_VALID_RULES: 'options.siteRules.importErrorNoValidRules',
};

/** 编辑态：域名是规则主键，创建后不可改 */
const isEditing = computed(() => !!editingRule.value);

/** 弹窗标题随视图切换 */
const dialogTitle = computed(() => {
  if (!showForm.value) return t('options.siteRules.title');
  return isEditing.value ? t('options.siteRules.editTitle') : t('options.siteRules.addTitle');
});

/**
 * 「跟随全局」在表单里的哨兵值
 *
 * 不能用空串：Element Plus 的 `el-select` 把 `''` 判成「未选」（`getOption` 对空串直接返回
 * 空标签），于是这一档**选中了也不显示标签**，框里只剩占位符——而本仓未装 EP 语言包
 * （约定是逐处显式传文案），那颗占位符还是英文的 `Select`。用户看到的既是语言不一致，
 * 也是「我明明选了跟随全局，框里却没字」。存储层仍以「不写该字段」表达跟随全局，
 * 哨兵只活在这份表单状态里，提交时按 `fillEntry !== FOLLOW_GLOBAL` 换算。
 */
const FOLLOW_GLOBAL = 'follow';

interface FormData {
  domain: string;
  usernameSelector: string;
  passwordSelector: string;
  penetrateShadow: boolean;
  /** 覆盖的填充档位；`FOLLOW_GLOBAL` 表示跟随全局（存储里以「不写该字段」表达） */
  fillEntry: FillEntry | typeof FOLLOW_GLOBAL;
}

const formData = reactive<FormData>({
  domain: '',
  usernameSelector: '',
  passwordSelector: '',
  penetrateShadow: true,
  fillEntry: FOLLOW_GLOBAL,
});

/** 档位 → 文案 key，与列表列、下拉选项共用同一份标签 */
const FILL_ENTRY_I18N_KEYS: Record<FillEntry, string> = {
  sidepanel: 'options.siteRules.fillSidepanel',
  inline: 'options.siteRules.fillInline',
  manual: 'options.siteRules.fillManual',
};

/** 列表列与表单复用的档位标签 */
const fillEntryLabel = (entry: FillEntry): string => t(FILL_ENTRY_I18N_KEYS[entry]);

/**
 * 选择器规则：要么两侧都填、要么都留空，且语法合法
 *
 * 不能只填一侧：`CustomSelectors` 是成对语义（消费端拿它同时覆盖账号/密码两个字段的来源），
 * 半条规则会让另一侧继续走启发式检测，用户看到的是一张「规则生效了一半」的页面。
 * 两侧都留空则合法——只覆盖填充档位、或只关影子穿透，都是有效规则。
 * 判定读的是 `formData` 而非回调里的 `value`，因为这条规则同时挂在账号与密码两个字段上，
 * 任一侧 blur 都要能对整对字段给出结论。
 */
const selectorRules = computed(() => [
  {
    validator: (_rule: unknown, _value: string, callback: (err?: Error) => void) => {
      const hasUsername = !!formData.usernameSelector.trim();
      const hasPassword = !!formData.passwordSelector.trim();
      if (hasUsername !== hasPassword) {
        return callback(new Error(t('options.siteRules.validateSelectorPair')));
      }
      callback();
    },
    trigger: 'blur',
  },
  {
    validator: (_rule: unknown, value: string, callback: (err?: Error) => void) => {
      const selector = (value ?? '').trim();
      if (selector && !isValidCssSelector(selector)) {
        return callback(new Error(t('options.siteRules.validateSelectorFormat')));
      }
      callback();
    },
    trigger: 'blur',
  },
]);

/** 按域名查找已有规则：忽略大小写与空白，避免历史混存 key 造成同一站点两条规则 */
const findRuleByDomain = (domain: string): SiteRule | undefined => {
  const normalized = normalizeSiteRuleDomain(domain);
  if (!normalized) return undefined;
  return rulesList.value.find(rule => normalizeSiteRuleDomain(rule.domain) === normalized);
};

/**
 * 重新校验「用户名 + 密码」这一对选择器
 *
 * 配对规则同时挂在两个字段上：只校验被改动的那一侧，另一侧已经显示的
 * 「需同时填写或同时留空」提示不会消失。拾取或手动输入任一侧后同时校验两字段，
 * 让提示随配对状态实时出现/消失。
 */
let selectorPairValidationScheduled = false;
const revalidateSelectorPair = (): void => {
  if (!showForm.value || !formRef.value || selectorPairValidationScheduled) return;
  selectorPairValidationScheduled = true;
  void nextTick(() => {
    selectorPairValidationScheduled = false;
    const validation = formRef.value?.validateField(['usernameSelector', 'passwordSelector']);
    if (validation) void validation.catch(() => {});
  });
};

const formRules = computed(() => ({
  domain: [
    { required: true, message: t('options.siteRules.validateDomain'), trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (err?: Error) => void) => {
        // 编辑态域名只读且来自存储，无需再校验格式与占用
        if (isEditing.value) return callback();
        const raw = (value ?? '').trim();
        if (!raw) return callback();
        const domain = normalizeSiteRuleDomain(raw);
        if (!domain) return callback(new Error(t('options.siteRules.validateDomainFormat')));
        if (findRuleByDomain(domain)) {
          return callback(new Error(t('options.siteRules.validateDomainDuplicate')));
        }
        callback();
      },
      trigger: 'blur',
    },
  ],
  usernameSelector: selectorRules.value,
  passwordSelector: selectorRules.value,
}));

/**
 * 列表加载代际
 *
 * 打开预填、保存、导入三条路径都会重载；只让最新一次结果落地，避免慢响应把
 * 已删除/已更新的规则铺回列表，也避免 `openPrefilledRule` 对着旧快照判「是否已存在」。
 */
let rulesLoadSeq = 0;

/**
 * 打开流程代际
 *
 * 「加载列表 → 进入预填表单」中间有一次 await，等待期间弹窗可能已被关闭：
 * 此时再把视图切到表单，等于在隐藏态写入用户没提交过的域名，下次打开先闪出上次的内容。
 */
let openFlowSeq = 0;

/** 加载规则列表（结果按 `rulesLoadSeq` 取最新） */
const loadRules = async () => {
  const seq = ++rulesLoadSeq;
  const rules = await getSiteRules();
  if (seq !== rulesLoadSeq) return;
  rulesList.value = Object.values(rules);
};

/** 重置表单字段 */
const resetForm = () => {
  formData.domain = '';
  formData.usernameSelector = '';
  formData.passwordSelector = '';
  formData.penetrateShadow = true;
  formData.fillEntry = FOLLOW_GLOBAL;
  formRef.value?.clearValidate();
};

/** 打开添加模式 */
const handleAdd = () => {
  cancelActivePick();
  editingRule.value = null;
  resetForm();
  showForm.value = true;
};

/** 打开编辑模式 */
const handleEdit = (rule: SiteRule) => {
  cancelActivePick();
  editingRule.value = rule;
  formData.domain = rule.domain;
  formData.usernameSelector = rule.customSelectors?.username ?? '';
  formData.passwordSelector = rule.customSelectors?.password ?? '';
  formData.penetrateShadow = rule.penetrateShadow ?? true;
  formData.fillEntry = rule.fillEntry ?? FOLLOW_GLOBAL;
  formRef.value?.clearValidate();
  showForm.value = true;
};

/** 取消编辑，回到列表 */
const cancelForm = () => {
  cancelActivePick();
  showForm.value = false;
  editingRule.value = null;
  resetForm();
};

/** 提交表单 */
const handleSubmit = async () => {
  if (!formRef.value) return;
  cancelActivePick();
  try {
    await formRef.value.validate();
  } catch {
    return; // 校验失败由表单内联提示，无需额外弹 toast
  }

  // 编辑态必须写回原 key（历史数据可能带大小写差异），否则同一条规则会被拆成两条、
  // 旧条目再也匹配不到；新增态用规范化后的域名，与内容脚本的精确匹配形态保持一致。
  const domain = editingRule.value?.domain ?? normalizeSiteRuleDomain(formData.domain) ?? formData.domain.trim();
  const username = formData.usernameSelector.trim();
  const password = formData.passwordSelector.trim();
  // 三项覆盖全为空：新增态是在造一条空壳，编辑态是在撤销这个站点的全部特殊处理，两种意图
  // 不能按同一条规则处置（见下面 clearingAll 分支）。
  const clearingAll = formData.fillEntry === FOLLOW_GLOBAL && formData.penetrateShadow && !(username && password);
  // 新增态拒绝入库：只带一个域名的规则什么都不做，却会在列表里长期占一行，
  // 让人以为这个站点已被管住（导入侧对同样的空规则也是直接剔除）。
  if (clearingAll && !editingRule.value) {
    ElMessage.warning(t('options.siteRules.validateEmptyRule'));
    return;
  }
  const patch: Omit<SiteRule, 'domain'> = { penetrateShadow: formData.penetrateShadow };
  // 选择器成对写入（校验已保证两侧同时有或同时无），两侧都空时干脆不写这个键，
  // 而不是留一条 `{ username: '', password: '' }`：消费端按「键存在」决定是否覆盖，空串只会变成两条永不命中的查询
  if (username && password) patch.customSelectors = { username, password };
  // 「跟随全局」= 不写该字段，而不是写死当前全局档位：写死会让用户之后的全局设置变更
  // 在这个站点上被永久挡掉，而那并不是他设规则时的意思。
  if (formData.fillEntry !== FOLLOW_GLOBAL) patch.fillEntry = formData.fillEntry;
  saving.value = true;
  try {
    // 编辑态把唯一覆盖改回跟随全局时整条规则移除，而不是拦下来报「请至少设置一项」：
    // 「跟随全局」是下拉里明摆着的选项，选了它却存不进去，等于给用户一条改不回去的死路。
    if (clearingAll) await removeSiteRule(domain);
    else await setSiteRule(domain, patch);
    await loadRules();
    cancelForm();
    ElMessage.success(t(clearingAll ? 'options.siteRules.clearSuccess' : 'options.siteRules.saveSuccess'));
  } catch (error) {
    logger.error('保存站点规则失败:', error);
    ElMessage.error(t('options.siteRules.saveError'));
  } finally {
    saving.value = false;
  }
};

/** 删除规则（二次确认） */
const handleDelete = async (rule: SiteRule) => {
  try {
    await ElMessageBox.confirm(
      t('options.siteRules.deleteConfirm', { domain: rule.domain }),
      t('options.siteRules.deleteConfirmTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
      },
    );
  } catch {
    return;
  }
  try {
    await removeSiteRule(rule.domain);
    await loadRules();
    ElMessage.success(t('options.siteRules.deleteSuccess'));
  } catch (error) {
    logger.error('删除站点规则失败:', error);
    ElMessage.error(t('options.siteRules.deleteError'));
  }
};

/**
 * 导出当前全部规则为明文 JSON 文件
 *
 * 模块内已带 cause 记录日志，这里只补用户可读的失败反馈，避免同一异常刷两遍。
 */
const handleExport = async () => {
  exporting.value = true;
  try {
    const count = await exportSiteRulesToFile();
    ElMessage.success(t('options.siteRules.exportSuccess', { count }));
  } catch {
    ElMessage.error(t('options.siteRules.exportError'));
  } finally {
    exporting.value = false;
  }
};

/** 转发到隐藏的 file input，避免为取一个文件再引入上传组件 */
const pickImportFile = () => fileInputRef.value?.click();

/**
 * 读取并导入所选文件
 *
 * `input.value` 必须在取文件后立即清空：改完规则后重导同一份文件是最常见的操作序列，
 * 不清空则同一个 `File` 不会再触发 change。
 */
const handleImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > SITE_RULES_IMPORT_MAX_INPUT_BYTES) {
    ElMessage.error(t('options.siteRules.importErrorFileTooLarge'));
    return;
  }

  importing.value = true;
  try {
    const { added, updated, dropped } = await importSiteRulesFromText(await file.text());
    await loadRules();
    // 被剔除的条数必须一起报：只报成功数会让「10 条只进了 3 条」看起来像全部导入
    const summary = t('options.siteRules.importSuccess', { added, updated });
    ElMessage.success(dropped ? `${summary}${t('options.siteRules.importSkipped', { dropped })}` : summary);
  } catch (error) {
    const code = getSiteRulesImportErrorCode(error);
    if (!code) {
      logger.error('导入站点规则失败:', error);
      ElMessage.error(t('options.siteRules.importError'));
      return;
    }
    ElMessage.error(
      code === 'TOO_MANY_RULES'
        ? t(IMPORT_ERROR_KEYS[code], { max: SITE_RULES_IMPORT_MAX_RULES })
        : t(IMPORT_ERROR_KEYS[code]),
    );
  } finally {
    importing.value = false;
  }
};

/** 弹窗关闭动画结束后复位到列表视图 */
const handleClosed = () => {
  cancelActivePick();
  showForm.value = false;
  editingRule.value = null;
  resetForm();
};

// 打开时刷新列表；携带预填域名（内容脚本失败引导）则直接进入该域名的新增/编辑表单。
// 同时监听 initialDomain，保证弹窗已开着时再次收到引导也能响应。
watch([() => props.modelValue, () => props.initialDomain], async ([open, domain]) => {
  if (!open) {
    // 关闭即刻作废未落地的打开流程，避免预填视图在隐藏态生效
    openFlowSeq += 1;
    return;
  }
  const seq = ++openFlowSeq;
  await loadRules();
  if (seq !== openFlowSeq) return;
  if (domain) openPrefilledRule(domain);
});

/**
 * 进入预填流程：已有规则则直接编辑，否则以该域名新增
 *
 * 「填充失败 → 就地引导」最常见的场景恰恰是规则已存在但字段选错了；若一味进新增态，
 * 会被重复域名校验挡死，用户既存不下也回不到列表。
 */
function openPrefilledRule(rawDomain: string): void {
  const domain = normalizeSiteRuleDomain(rawDomain);
  if (!domain) return;
  const existing = findRuleByDomain(domain);
  if (existing) {
    handleEdit(existing);
    return;
  }
  editingRule.value = null;
  resetForm();
  formData.domain = domain;
  showForm.value = true;
}
</script>

<style scoped>
.rules-view {
  min-height: 120px;
}

.text-gray {
  font-size: 13px;
  color: #999;
}

.selector-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.selector-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.selector-tag {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 12px;
  color: var(--aph-primary, #409eff);
  background: rgb(64 158 255 / 10%);
  border-radius: 3px;
}

.selector-line code {
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--aph-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
}

/* 覆盖档位标签：与选择器行的 .selector-tag 同族，但它是「一档设置」不是「一段代码」，
   用中性底色而不是主色胶囊，避免列表里两类信息看起来同等重要 */
.fill-entry-tag {
  display: inline-block;
  padding: 0 6px;
  font-size: 12px;
  line-height: 20px;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  border-radius: 3px;
}

.empty-tip {
  margin-top: -4px;
  font-size: 13px;
  line-height: 1.5;
  color: #909399;
}

/* 导入/导出口径说明：合并语义与「文件不含凭据」要在点按钮之前就看到，而不是事后补救 */
.transfer-tip {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}

.import-file-input {
  display: none;
}

.form-hint {
  margin-bottom: 18px;
}

/* 档位下拉与同列的输入框同宽（el-select 默认按内容收缩，跟隔壁 el-input 摆不齐） */
.fill-entry-select {
  width: 100%;
}

.field-tip {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}

/* 选择器输入框与「拾取」按钮同一行；输入框吸收剩余宽度，按钮不被压缩 */
.selector-field-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
}

.selector-field-input {
  flex: 1;
  min-width: 0;
}

.selector-pick-button {
  flex-shrink: 0;
}

.picker-tip {
  margin-top: 4px;
}

/* 影子 DOM 穿透行的下边距从 form-item 交给移到外面的提示语，
   保证「提示语贴开关 4px、行末留白 18px」的纵向节奏与改动前一致 */
.penetrate-item {
  margin-bottom: 0;
}

.penetrate-tip {
  margin-bottom: 18px;
}

/* 编辑态域名锁定字段。options 全局样式（entrypoints/options/styles.css）把所有输入框
   刷成主色边框 + 主色聚焦环，readonly 与可编辑态因此看不出任何区别；这里压成中性灰底灰边，
   聚焦只加深边框、不亮主色，域名本身仍是正常对比度、可选中复制。
   多带一层 .site-rules-form 是为压过全局那条 [data-v] .el-input .el-input__wrapper.is-focus */
.site-rules-form :deep(.domain-input--locked .el-input__wrapper),
.site-rules-form :deep(.domain-input--locked .el-input__wrapper:hover) {
  background-color: var(--el-fill-color-light);
  border-color: var(--el-border-color);
  box-shadow: none;
}

.site-rules-form :deep(.domain-input--locked .el-input__wrapper.is-focus) {
  background-color: var(--el-fill-color-light);
  border-color: var(--el-text-color-secondary);
  box-shadow: none;
}

/* 编辑态域名只读锁标：提示「不可改」而非「输入框失效」 */
.domain-lock {
  color: var(--el-text-color-secondary);
}

/* 操作列 link 按钮：抵消 options 全局 .el-button--primary 的实心背景/边框，
   否则主色文字压在同色背景上不可见（danger 型已由全局样式覆盖） */
:deep(.el-button--primary.is-link),
:deep(.el-button--primary.is-link:hover) {
  background-color: transparent;
  border-color: transparent;
}

:deep(.el-dialog__body) {
  padding-top: 12px;
}
</style>
