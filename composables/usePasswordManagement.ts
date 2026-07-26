import { ref, computed, watch, onScopeDispose, type Ref } from 'vue';
import type { FormRules, FormInstance } from 'element-plus';
import type { PasswordEntry, PasswordEntryWithUI } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { ExcelUtils } from '@/utils/excel';
import { EmailBackupUtils } from '@/utils/emailBackup';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { parseTags, stringifyTags, collectAllTags } from '@/utils/tagUtils';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { formatDateCompact, formatTimestampCompact } from '@/utils/dateFormat';
import { DEFAULT_SORT, sortPasswordEntries, comparePasswordEntries, type SortState } from '@/utils/passwordSort';
import { isValidTotpInput } from '@/utils/totp';

/** 最多可选择的标签数量 */
export const MAX_TAG_COUNT = 3;
/** 单个标签最大字符长度 */
export const MAX_TAG_LENGTH = 30;

/** 密码表单空值初始状态（避免多处重复字面量） */
const EMPTY_PASSWORD_FORM = { username: '', password: '', url: '', tag: '', remark: '', totp: '' } as const;

/**
 * URL/域名自定义校验器
 * 支持完整 URL（https://example.com）和纯域名（example.com / localhost）
 * @param _rule 校验规则（未使用）
 * @param value 用户输入的 URL 值
 * @param callback 校验回调函数
 */
const urlValidator = (_rule: any, value: string, callback: any) => {
  if (!value || !value.trim()) {
    callback(); // 选填，空值通过
    return;
  }
  const trimmed = value.trim();
  try {
    if (trimmed.includes('://')) {
      // 完整 URL 格式
      const url = new URL(trimmed);
      if (!url.hostname) {
        callback(new Error(t('form.invalidUrl')));
        return;
      }
    } else {
      // 纯域名格式：允许字母、数字、连字符、点号
      // 支持 localhost、IP 地址、标准域名
      const domainPattern =
        /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})$/;
      if (!domainPattern.test(trimmed)) {
        callback(new Error(t('form.invalidUrlExample')));
        return;
      }
    }
    callback();
  } catch {
    callback(new Error(t('form.invalidUrl')));
  }
};

/**
 * TOTP 密钥自定义校验器
 * 允许为空；非空时必须为合法的 otpauth:// 链接或 Base32 密钥
 * @param _rule 校验规则（未使用）
 * @param value 用户输入的密钥值
 * @param callback 校验回调函数
 */
const totpValidator = (_rule: any, value: string, callback: any) => {
  const trimmed = (value || '').trim();
  if (!trimmed || isValidTotpInput(trimmed)) {
    callback();
    return;
  }
  callback(new Error(t('form.invalidTotp')));
};

/**
 * 密码管理 Composable
 * 管理密码列表的 CRUD、搜索、排序、导入导出等逻辑
 */
export function usePasswordManagement(options: { validityForm: Ref<{ validityHours: number }> }) {
  const { validityForm } = options;

  // 状态
  const passwords = ref<PasswordEntry[]>([]);
  /** 当前排序状态（由 el-table @sort-change 驱动更新） */
  const currentSort = ref<SortState>({ ...DEFAULT_SORT });
  const showImportDialog = ref(false);
  const showPasswordDialog = ref(false);
  const showEmailBackupDialog = ref(false);
  const searchKeyword = ref('');
  /** 搜索关键词防抖副本：驱动 filteredPasswords 过滤，避免每次击键都重排大列表 */
  const debouncedSearchKeyword = ref('');
  /** 是否仅显示收藏条目 */
  const favoriteOnly = ref(false);
  const selectedIds = ref<string[]>([]);
  const isEditingPassword = ref(false);
  const editingPasswordId = ref<string>('');
  const passwordFormLoading = ref(false);
  const tableLoading = ref(false);
  /** 本地操作进行中标志，用于通知 storage watcher 跳过本轮 loadPasswords */
  const isLocalOperation = ref(false);
  const passwordForm = ref({
    username: '',
    password: '',
    url: '',
    tag: '',
    remark: '',
    totp: '',
  });

  const passwordFormRules = computed<FormRules>(() => ({
    username: [
      { required: true, message: t('form.usernameRequired'), trigger: 'blur' },
      { max: 50, message: t('form.usernameMax'), trigger: 'blur' },
    ],
    password: [{ max: 50, message: t('form.passwordMax'), trigger: 'blur' }],
    url: [
      { max: 100, message: t('form.urlMax'), trigger: 'blur' },
      { validator: urlValidator, trigger: 'blur' },
    ],
    tag: [{ max: 50, message: t('form.tagMax'), trigger: 'blur' }],
    remark: [{ max: 1000, message: t('form.remarkMax'), trigger: 'blur' }],
    totp: [{ validator: totpValidator, trigger: 'blur' }],
  }));

  // 计算属性（过滤 + 排序，替代 el-table 客户端排序）
  const filteredPasswords = computed(() => {
    let result: PasswordEntry[] = passwords.value;

    if (debouncedSearchKeyword.value) {
      const keyword = debouncedSearchKeyword.value.toLowerCase();
      result = result.filter(
        p =>
          p.username.toLowerCase().includes(keyword) ||
          p.tag.toLowerCase().includes(keyword) ||
          p.remark.toLowerCase().includes(keyword) ||
          p.url.toLowerCase().includes(keyword),
      );
    }

    if (favoriteOnly.value) {
      result = result.filter(p => p.favorite);
    }

    // 始终按当前排序状态排序（替代 el-table 客户端排序）
    return sortPasswordEntries([...result], currentSort.value);
  });

  /**
   * 包裹本地 storage 写入操作，设置标志位防止 storage watcher 重复触发 loadPasswords
   *
   * 原理：本地操作（复制/编辑/收藏/删除）已在 Vue 层就地更新状态，
   * 无需 storage watcher 再触发全量 loadPasswords。设置 isLocalOperation 标志后，
   * useStorageWatcher 会跳过 onPasswordDataChange 回调，避免 tableLoading 闪烁和全量替换数组引用。
   *
   * 延迟清除标志使用 setTimeout(0) 确保覆盖 chrome.storage.onChanged 的异步派发时序。
   *
   * @param fn 包含 storage 写入的异步操作
   */
  const runLocalOperation = async (fn: () => Promise<void>) => {
    isLocalOperation.value = true;
    try {
      await fn();
    } finally {
      // 延迟清除标志：chrome.storage.onChanged 在当前微任务之后派发，
      // setTimeout(0) 将清除推迟到下一个宏任务，确保事件处理时标志仍为 true
      setTimeout(() => {
        isLocalOperation.value = false;
      }, 0);
    }
  };

  /**
   * 搜索关键词防抖：输入框保持即时响应（v-model 仍绑定 searchKeyword），
   * 仅将驱动过滤的 debouncedSearchKeyword 延迟 200ms 更新，
   * 降低大列表连续击键时 filter + sort 的重排开销。
   */
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  watch(searchKeyword, value => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      debouncedSearchKeyword.value = value;
    }, 200);
  });

  // 作用域销毁时清理未触发的防抖定时器，避免向已停用作用域赋值
  onScopeDispose(() => clearTimeout(searchDebounceTimer));

  /** 收藏过滤变化时清空选中状态（符合交互策略：过滤条件变化清空选中） */
  watch(favoriteOnly, () => {
    selectedIds.value = [];
  });

  /**
   * 下拉候选标签列表
   * 从所有密码条目中聚合去重，供表单中的标签下拉选项使用。
   */
  const availableTags = computed<string[]>(() => collectAllTags(passwords.value));

  /**
   * 表单标签的数组视图
   * `passwordForm.tag` 仍以逗号拼接字符串作为最终写入源，本 computed 提供
   * 数组形式以便 `el-select multiple` 绑定；写入时自动调用 `stringifyTags`
   * 做去重与空项过滤。
   *
   * setter 中做两重兜底：
   * 1. 过滤超过 MAX_TAG_LENGTH 个字符的标签；
   * 2. 截断超过 MAX_TAG_COUNT 个的标签。
   */
  const tagArray = computed<string[]>({
    get: () => parseTags(passwordForm.value.tag),
    set: (value: string[]) => {
      const trimmed = value.map(v => String(v ?? '').trim()).filter(Boolean);
      const valid: string[] = [];
      let hasTooLong = false;
      for (const t of trimmed) {
        if (t.length > MAX_TAG_LENGTH) {
          hasTooLong = true;
          continue;
        }
        valid.push(t);
      }
      if (hasTooLong) {
        ElMessage.warning(t('form.tagLengthLimit', { max: MAX_TAG_LENGTH }));
      }
      let finalTags = valid;
      if (finalTags.length > MAX_TAG_COUNT) {
        finalTags = finalTags.slice(0, MAX_TAG_COUNT);
        ElMessage.warning(t('form.tagCountLimit', { max: MAX_TAG_COUNT }));
      }
      passwordForm.value.tag = stringifyTags(finalTags);
    },
  });

  /**
   * 切换收藏状态
   * 当收藏数已达上限时，自动淘汰最近最少使用（LRU）的收藏条目，再添加新收藏
   * 切换后自动滚动到目标行并短暂高亮，提供操作反馈
   */
  const toggleFavorite = async (id: string) => {
    try {
      const entry = passwords.value.find(p => p.id === id);
      if (!entry) return;
      const newFav = !entry.favorite;

      await runLocalOperation(async () => {
        if (newFav) {
          // 收藏前检查是否已达上限，若达则先淘汰 LRU 条目
          const evicted = await StorageUtils.evictLRUFavoriteIfNeeded(passwords.value);
          if (evicted) {
            const limit = await StorageUtils.getFavoriteLimit();
            ElMessage.info(t('sidepanel.favoriteEvicted', { limit, username: evicted.username }));
          }
          // 设置新收藏条目及其使用时间戳
          const now = Date.now();
          await StorageUtils.updatePassword(id, { favorite: true, favoriteUsedAt: now, updateTime: entry.updateTime });
          entry.favorite = true;
          entry.favoriteUsedAt = now;
          ElMessage.success(t('sidepanel.favorited'));
        } else {
          // 取消收藏，清除使用时间戳
          await StorageUtils.updatePassword(id, {
            favorite: false,
            favoriteUsedAt: undefined,
            updateTime: entry.updateTime,
          });
          entry.favorite = false;
          entry.favoriteUsedAt = undefined;
          ElMessage.success(t('sidepanel.unfavorited'));
        }
      });

      // 等待 el-table 完成虚拟 DOM 更新后滚动到目标行并高亮（复用 new-item 样式）
      setTimeout(() => {
        const row = document.querySelector(`.${id}`);
        if (row) {
          row.classList.add('new-item');
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => row.classList.remove('new-item'), 6000);
        }
      }, 100);
    } catch (error) {
      logger.error('切换收藏失败:', error);
      ElMessage.error(t('message.operationFailed'));
    }
  };

  // 加载密码列表
  const loadPasswords = async () => {
    try {
      tableLoading.value = true;

      const sessionValid = await StorageUtils.isSessionValid();
      if (!sessionValid) {
        passwords.value = [];
        return;
      }

      passwords.value = await StorageUtils.getAllPasswords();

      // 初始化每条记录的密码显隐状态
      passwords.value.forEach(p => {
        (p as PasswordEntryWithUI).showPassword = false;
      });
      // 排序由 filteredPasswords computed 处理，此处不再排序

      // 初始化有效期设置表单
      const validityHours = await StorageUtils.getMasterPasswordValidityHours();
      validityForm.value.validityHours = validityHours;
    } catch (error: unknown) {
      logger.error('加载密码列表失败:', error);
      const message = error instanceof Error ? error.message : t('message.unknownError');
      ElMessage.error(t('message.loadListFailedDetail', { message }));
    } finally {
      tableLoading.value = false;
    }
  };

  // 处理排序变化（同步更新 currentSort 并持久化）
  const handleSortChange = async ({ prop, order }: { prop: string; order: string }) => {
    currentSort.value = { prop, order: (order || null) as SortState['order'] };
    try {
      await StorageUtils.saveSortConfig({ prop, order });
    } catch (error) {
      logger.error('保存排序配置失败:', error);
    }
  };

  /**
   * 从存储恢复排序状态到 currentSort
   * 需在 onMounted 中、loadPasswords 之后调用，确保首次渲染使用正确的排序
   */
  const restoreSortConfig = async () => {
    try {
      const sortConfig = await StorageUtils.getSortConfig();
      if (sortConfig) {
        currentSort.value = { prop: sortConfig.prop, order: (sortConfig.order || null) as SortState['order'] };
      }
    } catch (error) {
      logger.debug('恢复排序配置失败:', error);
    }
  };

  // 切换密码可见性
  const togglePasswordVisibility = (row: any) => {
    row.showPassword = !row.showPassword;
  };

  // 处理表格每行的样式名
  const handleRowClassName = (data: { row: PasswordEntry; rowIndex: number }) => {
    return data.row.id;
  };

  // 选择变更处理
  const handleSelectionChange = (selection: PasswordEntry[]) => {
    selectedIds.value = selection.map(item => item.id);
  };

  // 打开密码弹窗（新增）
  const openPasswordDialog = () => {
    isEditingPassword.value = false;
    editingPasswordId.value = '';
    passwordForm.value = { ...EMPTY_PASSWORD_FORM };
    showPasswordDialog.value = true;
  };

  // 编辑密码
  const editPassword = (password: PasswordEntry) => {
    isEditingPassword.value = true;
    editingPasswordId.value = password.id;
    passwordForm.value = {
      username: password.username,
      password: password.password,
      url: password.url,
      tag: password.tag,
      remark: password.remark,
      totp: password.totp ?? '',
    };
    showPasswordDialog.value = true;
  };

  // 重置密码表单
  const resetPasswordForm = () => {
    isEditingPassword.value = false;
    editingPasswordId.value = '';
    passwordForm.value = { ...EMPTY_PASSWORD_FORM };
  };

  // 滚动到密码项
  const scrollToPassword = (id: string) => {
    setTimeout(() => {
      const passwordElement = document.querySelector(`.${id}`);
      if (passwordElement) {
        passwordElement.classList.add('new-item');
        setTimeout(() => {
          passwordElement.classList.remove('new-item');
        }, 6000);

        passwordElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }, 100);
  };

  // 处理密码表单保存
  const handlePasswordFormSave = async (formRef?: FormInstance) => {
    try {
      if (formRef) {
        await formRef.validate();
      }
      passwordFormLoading.value = true;

      // 对标签做归一化：拆分 → 去空/去重 → 英文逗号拼接
      const normalizedTag = stringifyTags(parseTags(passwordForm.value.tag));

      if (isEditingPassword.value) {
        const updatedFields = {
          username: passwordForm.value.username.trim(),
          password: passwordForm.value.password,
          url: passwordForm.value.url.trim(),
          tag: normalizedTag,
          remark: passwordForm.value.remark.trim(),
          totp: passwordForm.value.totp.trim(),
          updateTime: Date.now(),
        };
        await runLocalOperation(async () => {
          await StorageUtils.updatePassword(editingPasswordId.value, updatedFields);
        });
        // 就地更新：filteredPasswords computed 会自动重新排序
        const entry = passwords.value.find(p => p.id === editingPasswordId.value);
        if (entry) {
          Object.assign(entry, updatedFields);
        }
        ElMessage.success(t('form.updateSuccess'));
        scrollToPassword(editingPasswordId.value);
      } else {
        const now = Date.now();
        let newEntry: PasswordEntry;
        await runLocalOperation(async () => {
          newEntry = await StorageUtils.savePassword({
            username: passwordForm.value.username.trim(),
            password: passwordForm.value.password,
            url: passwordForm.value.url.trim(),
            tag: normalizedTag,
            remark: passwordForm.value.remark.trim(),
            totp: passwordForm.value.totp.trim(),
            createTime: now,
            updateTime: now,
          });
        });
        // 就地插入：filteredPasswords computed 会自动重新排序
        (newEntry! as PasswordEntryWithUI).showPassword = false;
        passwords.value.push(newEntry!);
        ElMessage.success(t('form.addSuccess'));
        scrollToPassword(newEntry!.id);
      }

      showPasswordDialog.value = false;
      resetPasswordForm();
    } catch (error) {
      logger.error('保存密码失败:', error);
      ElMessage.error(t('message.saveFailed'));
    } finally {
      passwordFormLoading.value = false;
    }
  };

  // 复制密码
  const copyPassword = async (password: PasswordEntry) => {
    try {
      const newPasswordEntry = {
        username: password.username,
        password: password.password,
        url: password.url,
        tag: password.tag,
        remark: password.remark,
        totp: password.totp,
        createTime: password.createTime,
        updateTime: Date.now(),
      };

      const copyItemId = password.id;
      let newEntry: PasswordEntry;
      await runLocalOperation(async () => {
        newEntry = await StorageUtils.savePassword(newPasswordEntry, undefined, copyItemId);
      });
      // 就地插入：filteredPasswords computed 会自动重新排序
      (newEntry! as PasswordEntryWithUI).showPassword = false;
      passwords.value.push(newEntry!);

      setTimeout(() => {
        const copyAddedItem = document.querySelector(`.${newEntry!.id}`);
        if (copyAddedItem) {
          copyAddedItem.classList.add('new-item');
          copyAddedItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            copyAddedItem.classList.remove('new-item');
          }, 6000);
        }
      }, 100);

      ElMessage.success(t('form.copySuccess'));
    } catch (error: any) {
      logger.error('复制密码失败:', error);
      ElMessage.error(t('form.copyFailedDetail', { message: error.message || t('message.unknownError') }));
    }
  };

  // 删除密码
  const deletePassword = async (id: string) => {
    try {
      await ElMessageBox.confirm(t('form.deleteConfirm'), t('form.deleteConfirmTitle'), {
        confirmButtonText: t('form.moveToTrash'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      });

      const delItem = document.querySelector(`.${id}`) as HTMLElement | undefined;
      if (delItem) {
        delItem.classList.add('del-item');
        setTimeout(async () => {
          delItem.remove();
          await runLocalOperation(async () => {
            await StorageUtils.deletePassword(id);
          });
          await loadPasswords();
          ElMessage.success(t('form.movedToTrash'));
        }, 1000);
      }
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(t('message.deleteFailed'));
      }
    }
  };

  // 批量删除
  const batchDelete = async () => {
    try {
      await ElMessageBox.confirm(
        t('form.batchDeleteConfirm', { count: selectedIds.value.length }),
        t('form.batchDeleteConfirmTitle'),
        {
          confirmButtonText: t('form.moveToTrash'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
        },
      );

      const patchDelItems: HTMLElement[] = [];
      selectedIds.value.forEach((id: string) => {
        const delItem = document.querySelector(`.${id}`) as HTMLElement | undefined;
        if (delItem) {
          delItem.classList.add('del-item');
          patchDelItems.push(delItem);
        }
      });
      setTimeout(async () => {
        patchDelItems.forEach(delItem => {
          delItem.remove();
        });

        await runLocalOperation(async () => {
          await StorageUtils.deletePasswords(selectedIds.value);
        });
        await loadPasswords();
        selectedIds.value = [];
        ElMessage.success(t('form.movedToTrash'));
      }, 1000);
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(t('form.batchDeleteFailed'));
      }
    }
  };

  // 密码导入处理
  const handlePasswordsImported = async () => {
    await loadPasswords();
  };

  // 导出密码
  const exportPasswords = async () => {
    try {
      if (passwords.value.length === 0) {
        ElMessage.warning(t('form.noDataToExport'));
        return;
      }

      const masterPassword = await promptAndVerifyMasterPassword(
        t('session.verifyTitle'),
        t('form.exportVerifyPrompt'),
      );
      if (!masterPassword) return;

      // 生成带日期后缀的文件名：passwords_YYYYMMDD_HHmmss.csv
      const filename = `passwords_${formatTimestampCompact()}.csv`;
      ExcelUtils.exportToCSV(passwords.value, filename);
      ElMessage.success(t('form.exportSuccess'));
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('导出失败:', error);
        ElMessage.error(t('form.exportFailed'));
      }
    }
  };

  // 下载模板
  const downloadTemplate = () => {
    try {
      ExcelUtils.downloadTemplate();
      ElMessage.success(t('form.templateSuccess'));
    } catch (_error) {
      ElMessage.error(t('form.templateFailed'));
    }
  };

  // 导出密码为 JSON
  const exportPasswordsJson = async () => {
    try {
      if (passwords.value.length === 0) {
        ElMessage.warning(t('form.noDataToExport'));
        return;
      }

      const masterPassword = await promptAndVerifyMasterPassword(
        t('session.verifyTitle'),
        t('form.exportVerifyPrompt'),
      );
      if (!masterPassword) return;

      const now = new Date();
      const filename = `passwords_${formatTimestampCompact(now)}.json`;
      ExcelUtils.exportToJSON(passwords.value, filename);
      ElMessage.success(t('form.exportSuccess'));
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('JSON 导出失败:', error);
        ElMessage.error(t('form.exportFailed'));
      }
    }
  };

  /**
   * 打开邮箱备份弹窗
   */
  const openEmailBackupDialog = () => {
    showEmailBackupDialog.value = true;
  };

  /**
   * 执行密码备份到邮箱
   * 流程：验证主密码 -> 根据加密选项导出文件 -> 调用邮件工具
   *
   * @param email     目标邮箱地址
   * @param encrypted 是否使用加密备份（.aph 格式）
   */
  const backupToEmail = async (email: string, encrypted: boolean) => {
    try {
      if (passwords.value.length === 0) {
        ElMessage.warning(t('message.noDataToBackup'));
        return;
      }

      const masterPassword = await promptAndVerifyMasterPassword(
        t('session.verifyTitle'),
        encrypted ? t('options.backup.exportPrompt') : t('form.backupVerifyPrompt'),
      );
      if (!masterPassword) return;

      if (encrypted) {
        // 加密备份：导出 .aph 文件并打开邮件客户端
        await exportEncryptedBackup(passwords.value, masterPassword);
        const mailtoUrl = EmailBackupUtils.buildMailtoUrl(
          email,
          t('form.emailSubjectEncrypted', { date: formatDateCompact(new Date()) }),
          [
            t('form.emailBodyTime', { time: new Date().toLocaleString() }),
            t('form.emailBodyCount', { count: passwords.value.length }),
            t('form.emailBodyAttachment'),
            '',
            t('form.emailBodySend'),
            t('form.emailBodyNote'),
          ].join('\n'),
        );
        window.open(mailtoUrl, '_blank');
        ElMessage.success(t('form.encryptedBackupDone'));
      } else {
        // 不加密备份：导出 CSV 文件
        await EmailBackupUtils.backupToEmail(passwords.value, email);
        ElMessage.success(t('form.backupDone'));
      }
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('备份到邮箱失败:', error);
        ElMessage.error(t('options.emailBackup.backupFailed'));
      }
    }
  };

  /**
   * 一键去重
   * 检测 username + url 相同的重复条目，每组优先保留收藏项（多条收藏时保留 updateTime 最新的），
   * 无收藏时保留 updateTime 最新的一项，其余删除。
   */
  const removeDuplicates = async () => {
    const groups = new Map<string, PasswordEntry[]>();
    for (const entry of passwords.value) {
      const key = [entry.username, entry.url].join('|');
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    const idsToRemove: string[] = [];
    let duplicateGroupCount = 0;
    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      duplicateGroupCount++;
      // 收藏优先，其次按 updateTime 降序，保留第一条（复用公共比较器）
      group.sort((a, b) => comparePasswordEntries(a, b, DEFAULT_SORT));
      for (let i = 1; i < group.length; i++) {
        idsToRemove.push(group[i].id);
      }
    }

    if (idsToRemove.length === 0) {
      ElMessage.info(t('form.noDuplicates'));
      return;
    }

    try {
      await ElMessageBox.confirm(
        t('form.dedupeConfirm', { groups: duplicateGroupCount, count: idsToRemove.length }),
        t('options.header.removeDuplicates'),
        {
          confirmButtonText: t('common.confirm'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
        },
      );

      await runLocalOperation(async () => {
        await StorageUtils.deletePasswords(idsToRemove);
      });
      await loadPasswords();
      selectedIds.value = [];
      ElMessage.success(t('form.dedupeDone', { count: idsToRemove.length }));
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('一键去重失败:', error);
        ElMessage.error(t('form.dedupeFailed'));
      }
    }
  };

  return {
    // 状态
    passwords,
    showImportDialog,
    showPasswordDialog,
    showEmailBackupDialog,
    searchKeyword,
    selectedIds,
    isEditingPassword,
    editingPasswordId,
    passwordForm,
    passwordFormRules,
    passwordFormLoading,
    tableLoading,
    favoriteOnly,
    filteredPasswords,
    currentSort,
    availableTags,
    tagArray,
    // 方法
    loadPasswords,
    handleSortChange,
    restoreSortConfig,
    togglePasswordVisibility,
    handleRowClassName,
    handleSelectionChange,
    openPasswordDialog,
    editPassword,
    resetPasswordForm,
    handlePasswordFormSave,
    copyPassword,
    deletePassword,
    batchDelete,
    handlePasswordsImported,
    exportPasswords,
    exportPasswordsJson,
    downloadTemplate,
    openEmailBackupDialog,
    backupToEmail,
    toggleFavorite,
    removeDuplicates,
    isLocalOperation,
  };
}
