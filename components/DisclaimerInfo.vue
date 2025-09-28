<template>
  <!-- 免责声明 -->
  <div class="disclaimer-section">
    <el-alert
      title="重要提示"
      description="本插件的所有数据均保存在本地，插件功能只用于开发和测试环境使用，严禁保存办公和个人密码，如发生密码泄露，后果自负！"
      type="warning"
      :closable="false"
      show-icon
      size="small"
    />
  </div>
</template>

<script setup lang="ts">
// 添加一个空的script标签以触发重新编译
</script>

<style scoped></style>
