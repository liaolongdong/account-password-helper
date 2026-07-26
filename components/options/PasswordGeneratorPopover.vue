<template>
  <el-popover
    :visible="popoverVisible"
    placement="right"
    :width="300"
    popper-class="password-generator-popover"
    @update:visible="handleVisibleChange"
  >
    <template #reference>
      <el-button
        :icon="MagicStick"
        circle
        size="small"
        class="generator-trigger-btn"
        :title="t('options.generator.title')"
        :disabled="disabled"
        @click="togglePopover"
      />
    </template>

    <div class="generator-content">
      <!-- 生成密码展示区 -->
      <div class="password-display">
        <div class="password-text">{{ generatedPassword }}</div>
        <el-button
          :icon="RefreshRight"
          link
          size="small"
          :title="t('options.generator.regenerate')"
          @click="regenerate"
        />
      </div>

      <!-- 密码强度指示 -->
      <div class="strength-row">
        <el-progress
          :percentage="strength.percentage"
          :color="strength.color"
          :stroke-width="4"
          :show-text="false"
        />
        <span
          v-if="strength.label"
          class="strength-label"
          :style="{ color: strength.color }"
        >
          {{ strength.label }}
        </span>
      </div>

      <!-- 模式切换 -->
      <div class="mode-toggle">
        <el-radio-group
          v-model="mode"
          size="small"
        >
          <el-radio-button value="random">
            {{ t('options.generator.modeRandom') }}
          </el-radio-button>
          <el-radio-button value="passphrase">
            {{ t('options.generator.modePassphrase') }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- 配置区 -->
      <div class="config-section">
        <!-- 随机密码配置 -->
        <template v-if="mode === 'random'">
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.length') }}</span>
            <el-slider
              v-model="config.length"
              :min="6"
              :max="50"
              :step="1"
              :show-input="true"
              size="small"
              class="length-slider"
            />
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.uppercase') }}</span>
            <el-switch
              v-model="config.uppercase"
              size="small"
            />
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.lowercase') }}</span>
            <el-switch
              v-model="config.lowercase"
              size="small"
            />
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.numbers') }}</span>
            <el-switch
              v-model="config.numbers"
              size="small"
            />
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.symbols') }}</span>
            <el-switch
              v-model="config.symbols"
              size="small"
            />
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.excludeAmbiguous') }}</span>
            <el-switch
              v-model="config.excludeAmbiguous"
              size="small"
            />
          </div>
        </template>

        <!-- 助记词组配置 -->
        <template v-else>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.wordCount') }}</span>
            <el-slider
              v-model="passphraseConfig.wordCount"
              :min="3"
              :max="8"
              :step="1"
              :show-input="true"
              size="small"
              class="length-slider"
            />
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.separator') }}</span>
            <el-select
              v-model="passphraseConfig.separator"
              size="small"
              class="separator-select"
            >
              <el-option
                v-for="opt in separatorOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.capitalize') }}</span>
            <el-switch
              v-model="passphraseConfig.capitalize"
              size="small"
            />
          </div>
          <div class="config-row">
            <span class="config-label">{{ t('options.generator.appendNumber') }}</span>
            <el-switch
              v-model="passphraseConfig.appendNumber"
              size="small"
            />
          </div>
          <div
            v-if="passphraseConfig.appendNumber"
            class="config-row"
          >
            <span class="config-label">{{ t('options.generator.numberDigits') }}</span>
            <el-slider
              v-model="passphraseConfig.numberDigits"
              :min="1"
              :max="4"
              :step="1"
              :show-input="true"
              size="small"
              class="length-slider"
            />
          </div>
        </template>
      </div>

      <!-- 使用按钮 -->
      <el-button
        type="primary"
        size="small"
        class="use-password-btn"
        :disabled="!generatedPassword"
        @click="handleConfirm"
      >
        {{ t('options.generator.usePassword') }}
      </el-button>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { MagicStick, RefreshRight } from '@element-plus/icons-vue';
import { generatePassword, type PasswordGeneratorOptions } from '@/utils/passwordGenerator';
import { generatePassphrase, SEPARATOR_OPTIONS, type PassphraseGeneratorOptions } from '@/utils/passphraseGenerator';
import { usePasswordStrength } from '@/composables/usePasswordStrength';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

/** 生成器模式：随机密码 | 助记词组 */
type GeneratorMode = 'random' | 'passphrase';

const emit = defineEmits<{
  /** 确认使用生成的密码 */
  confirm: [password: string];
}>();

defineProps<{
  /** 是否禁用（表单加载时禁用） */
  disabled?: boolean;
}>();

const { t } = useI18n();

/** 弹窗可见状态 */
const popoverVisible = ref(false);

/** 当前生成模式 */
const mode = ref<GeneratorMode>('random');

/** 随机密码配置 */
const config = ref<Required<PasswordGeneratorOptions>>({
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
});

/** 助记词组配置 */
const passphraseConfig = ref<Required<PassphraseGeneratorOptions>>({
  wordCount: 4,
  separator: '-',
  capitalize: true,
  appendNumber: true,
  numberDigits: 2,
});

/** 分隔符选项列表 */
const separatorOptions = SEPARATOR_OPTIONS;

/** 当前生成的密码 */
const generatedPassword = ref('');

/** 密码强度响应式引用 */
const passwordRef = computed(() => generatedPassword.value);

/** 复用密码强度计算 */
const { strength } = usePasswordStrength(passwordRef);

/**
 * 生成新密码（根据当前模式选择随机密码或助记词组）
 */
const regenerate = async () => {
  try {
    if (mode.value === 'passphrase') {
      generatedPassword.value = await generatePassphrase(passphraseConfig.value);
    } else {
      generatedPassword.value = generatePassword(config.value);
    }
  } catch (error) {
    logger.error('密码生成失败:', error);
    generatedPassword.value = '';
  }
};

/**
 * 切换弹窗显隐
 */
const togglePopover = () => {
  popoverVisible.value = !popoverVisible.value;
};

/**
 * 处理弹窗显隐变更
 */
const handleVisibleChange = (visible: boolean) => {
  popoverVisible.value = visible;
};

/**
 * 确认使用当前密码
 */
const handleConfirm = () => {
  emit('confirm', generatedPassword.value);
  popoverVisible.value = false;
};

// 监听随机密码配置变化，自动重新生成
watch(
  config,
  () => {
    if (popoverVisible.value && mode.value === 'random') {
      regenerate();
    }
  },
  { deep: true },
);

// 监听助记词组配置变化，自动重新生成
watch(
  passphraseConfig,
  () => {
    if (popoverVisible.value && mode.value === 'passphrase') {
      regenerate();
    }
  },
  { deep: true },
);

// 模式切换时重新生成
watch(mode, () => {
  if (popoverVisible.value) {
    regenerate();
  }
});

// 弹窗打开时自动生成
watch(popoverVisible, visible => {
  if (visible) {
    regenerate();
  }
});
</script>

<style scoped>
.generator-trigger-btn {
  color: #909399;
  transition: color 0.2s;
}

.generator-trigger-btn:hover {
  color: var(--aph-primary);
}

:global(.password-generator-popover) {
  padding: 16px;
}

.generator-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.password-display {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  font-family: 'Courier New', Courier, monospace;
  background: #f5f7fa;
  border-radius: 6px;
}

.password-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: #303133;
  word-break: break-all;
  user-select: all;
}

.strength-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.strength-row > .el-progress {
  flex: 1;
}

.strength-label {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
}

.mode-toggle {
  display: flex;
  justify-content: center;
}

.separator-select {
  width: 100px;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.config-label {
  font-size: 13px;
  color: #606266;
}

.use-password-btn {
  align-self: stretch;
}
</style>

<style>
/* 密码生成器弹窗 - 全局样式（popover 内容通过 teleport 渲染到 body，scoped 样式不生效） */
.password-generator-popover .length-slider {
  width: 230px;
}

/* 缩小输入框宽度，为滑动条轨道腾出更多拖拽空间 */
.password-generator-popover .length-slider .el-slider__input {
  width: 88px;
}
</style>
