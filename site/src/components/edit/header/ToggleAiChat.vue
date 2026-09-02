<template>
  <button
    v-if="isAiEnabled"
    class="round-btn flex-shrink-0 hidden md:flex"
    :aria-label="isOpen ? $t('toolbar.close') : $t('ai.open')"
    :title="isOpen ? $t('toolbar.close') : $t('ai.open')"
    @click="$emit('toggleAiChat')"
  >
    <span :class="isOpen ? 'i-mdi:robot' : 'i-mdi:robot-outline'" md:text-lg />
  </button>
</template>

<script lang="ts" setup>
defineProps<{
  isOpen: boolean;
}>();

defineEmits<{
  (e: "toggleAiChat"): void;
}>();

const isAiEnabled = ref(false);

onMounted(() => {
  isAiEnabled.value = getAiToken() !== "";
});
</script>
