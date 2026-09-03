<template>
  <div class="hstack min-w-0 flex-none gap-1">
    <button
      v-bind="api.triggerProps"
      class="version-trigger"
      type="button"
      :title="$t('versions.title')"
    >
      <span i-mdi:source-branch flex-shrink-0 />
      <span class="max-w-28 truncate">{{ current?.label ?? $t("versions.none") }}</span>
      <span v-if="isDirty" class="version-dot" :title="$t('versions.unsaved')" />
      <span i-tabler:chevron-down flex-shrink-0 />
    </button>

    <Dialog
      id="version-diff"
      :title="$t('versions.diff_title')"
      icon="i-mdi:file-compare"
      box-class="w-11/12 max-w-160"
    >
      <template #button>
        <button
          class="round-btn flex-shrink-0"
          type="button"
          :aria-label="$t('versions.changes')"
          :title="$t('versions.changes')"
        >
          <span i-mdi:file-compare md:text-lg />
        </button>
      </template>

      <template #content>
        <div class="version-diff-body">
          <ResumeDiff
            v-if="isDirty"
            :before="current?.markdown ?? ''"
            :after="data.mdContent"
            :title="
              $t('versions.diff_unsaved', {
                label: current?.label ?? $t('versions.none')
              })
            "
          />
          <ResumeDiff
            v-if="current"
            :before="parent?.markdown ?? ''"
            :after="current.markdown"
            :title="
              parent
                ? $t('versions.diff_since', { label: parent.label })
                : $t('versions.diff_first')
            "
          />
          <p v-else-if="!isDirty" class="version-empty">{{ $t("versions.none_hint") }}</p>
        </div>
      </template>
    </Dialog>

    <div v-bind="api.positionerProps" class="z-40">
      <div v-bind="api.contentProps" class="version-menu">
        <p class="version-lineage">
          <span
            >{{ $t("versions.current") }}:
            {{ current?.label ?? $t("versions.none") }}</span
          >
          <span
            >{{ $t("versions.parent") }}: {{ parent?.label ?? $t("versions.na") }}</span
          >
          <span>{{ $t("versions.base") }}: {{ base?.label ?? $t("versions.na") }}</span>
          <span v-if="current?.jobTarget">
            {{ $t("versions.job_target") }}: {{ current.jobTarget }}
          </span>
        </p>

        <template v-if="current">
          <div v-bind="api.getItemProps({ value: 'rename' })" class="version-item">
            <span i-mdi:rename-outline text-base />
            <span>{{ $t("versions.rename") }}</span>
          </div>
          <div
            v-if="!currentIsBase"
            v-bind="api.getItemProps({ value: 'base' })"
            class="version-item"
          >
            <span i-mdi:bookmark-outline text-base />
            <span>{{ $t("versions.make_base") }}</span>
          </div>
        </template>

        <p v-if="!record.versions.length" class="version-empty">
          {{ $t("versions.none_hint") }}
        </p>

        <ul v-else class="version-list">
          <li
            v-for="version in ordered"
            :key="version.id"
            v-bind="api.getItemProps({ value: `switch:${version.id}` })"
            class="version-item version-item--row"
          >
            <span
              :class="
                version.id === record.currentId
                  ? 'i-tabler:check'
                  : isBase(version)
                    ? 'i-mdi:bookmark-outline'
                    : 'i-mdi:source-commit'
              "
              text-base
            />
            <span class="min-w-0 flex-1 truncate">{{ version.label }}</span>
            <span v-if="version.summary" class="version-stat">{{ version.summary }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import * as menu from "@zag-js/menu";
import { normalizeProps, useMachine } from "@zag-js/vue";
import type { VersionRecord } from "~/types";

const { data } = useDataStore();
const { t } = useI18n();

const record = ref<VersionRecord>({ currentId: null, versions: [] });

const load = async () => {
  record.value = await getVersionRecord(data.curResumeId);
};

const current = computed(() => currentVersion(record.value));
const parent = computed(() => parentVersion(record.value, current.value));
const base = computed(() => baseVersion(record.value, current.value));
const currentIsBase = computed(() => !!current.value && isBase(current.value));
const ordered = computed(() => [...record.value.versions].reverse());

// The document has moved on from the version it was saved as.
const isDirty = computed(() =>
  current.value ? current.value.markdown !== data.mdContent : !!data.mdContent
);

const switchTo = async (versionId: string) => {
  const version = findVersion(record.value, versionId);
  if (!version || !data.curResumeId || versionId === record.value.currentId) return;
  // Unsaved edits live in no version, so switching would drop them.
  if (isDirty.value && !window.confirm(t("versions.switch_confirm"))) return;

  setResumeMd(version.markdown);
  await setCurrentVersion(data.curResumeId, versionId);
  // keep durable storage in step with the pointer, without creating a version
  await saveCurrentResume(false, false);
};

const onSelect = async ({ value }: { value: string }) => {
  if (!data.curResumeId) return;
  if (value.startsWith("switch:")) return switchTo(value.slice("switch:".length));
  if (!current.value) return;

  if (value === "rename") {
    const label = window.prompt(t("versions.rename_prompt"), current.value.label)?.trim();
    if (label) await renameVersion(data.curResumeId, current.value.id, label);
  } else if (value === "base") {
    await markAsBase(data.curResumeId, current.value.id);
  }
};

const [state, send] = useMachine(
  menu.machine({
    id: "resume-versions",
    "aria-label": t("versions.title"),
    positioning: { placement: "bottom-start", gutter: 6 },
    onSelect
  })
);

const api = computed(() => menu.connect(state.value, send, normalizeProps));

watch([versionsRev, () => data.curResumeId], load);
onMounted(load);
</script>

<style scoped>
.version-trigger {
  @apply hstack min-w-0 flex-none gap-1 rounded px-2 py-1 text-xs text-light-c hover:bg-darker-c md:text-sm;
}

.version-dot {
  @apply size-1.5 flex-none rounded-full bg-blue-500;
}

.version-menu {
  @apply dropdown-container z-40 max-h-80 w-64 overflow-y-auto py-1 text-xs md:text-sm;
}

.version-lineage {
  @apply flex flex-col gap-0.5 border-b border-c px-3 py-2 text-light-c;
}

.version-item {
  @apply hstack cursor-pointer gap-1.5 px-3 py-1.5 text-c;
}

.version-item[data-highlighted] {
  @apply bg-darker-c;
}

.version-item--row {
  @apply gap-2;
}

.version-list {
  @apply border-t border-c pt-1;
}

.version-stat {
  @apply flex-none font-mono text-light-c;
}

.version-empty {
  @apply px-3 py-2 text-light-c italic;
}

.version-diff-body {
  @apply flex flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1;
  max-height: 70vh;
}
</style>
