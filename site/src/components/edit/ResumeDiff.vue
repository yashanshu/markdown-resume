<template>
  <div class="resume-diff" role="group" :aria-label="title ?? $t('versions.diff_title')">
    <p v-if="title" class="resume-diff-title">
      {{ title }}
      <span v-if="stat" class="resume-diff-stat">{{ stat }}</span>
    </p>
    <p v-if="!lines.length" class="resume-diff-empty">{{ $t("versions.no_changes") }}</p>
    <ol v-else class="resume-diff-lines">
      <li
        v-for="(line, i) in lines"
        :key="i"
        :class="`resume-diff-line resume-diff-line--${line.type}`"
      >
        <template v-if="line.type === 'gap'">
          {{ $t("versions.diff_gap", { count: line.text }) }}
        </template>
        <template v-else>
          <span class="resume-diff-marker" aria-hidden="true">{{
            marker(line.type)
          }}</span>
          <span class="resume-diff-text">{{ line.text || " " }}</span>
        </template>
      </li>
    </ol>
  </div>
</template>

<script lang="ts" setup>
import { collapseUnchanged, diffSummary, lineDiff, type DiffLine } from "~/utils/diff";

const props = defineProps<{ before: string; after: string; title?: string }>();

const stat = computed(() => diffSummary(props.before, props.after));

// Nothing to show when the two sides are identical.
const lines = computed<DiffLine[]>(() =>
  stat.value ? collapseUnchanged(lineDiff(props.before, props.after)) : []
);

// screen readers get the word, sighted readers the sign
const marker = (type: DiffLine["type"]) =>
  type === "add" ? "+" : type === "del" ? "−" : " ";
</script>

<style scoped>
.resume-diff {
  @apply text-xs;
}

.resume-diff-title {
  @apply hstack gap-2 pb-1 text-light-c;
}

.resume-diff-stat {
  @apply font-mono;
}

.resume-diff-empty {
  @apply py-2 text-light-c italic;
}

.resume-diff-lines {
  @apply font-mono whitespace-pre-wrap break-words rounded border border-c;
}

.resume-diff-line {
  @apply flex gap-1 px-2 py-0.25;
}

.resume-diff-line--add {
  @apply bg-green-500/12 text-green-800 dark:text-green-300;
}

.resume-diff-line--del {
  @apply bg-red-500/12 text-red-800 dark:text-red-300;
}

.resume-diff-line--gap {
  @apply justify-center border-y border-c text-light-c italic;
}

.resume-diff-marker {
  @apply w-2 flex-none select-none;
}

.resume-diff-text {
  @apply min-w-0 flex-1;
}
</style>
