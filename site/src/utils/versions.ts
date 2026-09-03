import { ref } from "vue";
import * as localForage from "localforage";
import { isClient } from "@renovamen/utils";
import { diffSummary } from "./diff";
import type { ResumeVersion, VersionRecord } from "~/types";

/**
 * One localForage key per resume: a save rewrites that resume's history only,
 * never every version of every resume.
 */
const VERSIONS_PREFIX = "MARKDOWN_RESUME_versions_";
const versionsKey = (resumeId: string) => `${VERSIONS_PREFIX}${resumeId}`;

const emptyRecord = (): VersionRecord => ({ currentId: null, versions: [] });

/** Bumped on every mutation so open pickers reload. */
export const versionsRev = ref(0);

export const findVersion = (record: VersionRecord, id: string | null) =>
  record.versions.find((v) => v.id === id) ?? null;

export const currentVersion = (record: VersionRecord) =>
  findVersion(record, record.currentId);

export const parentVersion = (record: VersionRecord, version: ResumeVersion | null) =>
  version ? findVersion(record, version.parentId) : null;

export const baseVersion = (record: VersionRecord, version: ResumeVersion | null) =>
  version ? findVersion(record, version.baseId) : null;

/** A node is a base when it is its own base. */
export const isBase = (version: ResumeVersion) => version.baseId === version.id;

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Pure graph append: a new node is a child of the current pointer and inherits
 * its base; with no parent it is the root and its own base. Saving unchanged
 * markdown is a no-op, so pressing save twice does not spawn a node.
 */
export const appendVersion = (
  record: VersionRecord,
  input: { resumeId: string; markdown: string; label?: string; jobTarget?: string }
): { record: VersionRecord; version: ResumeVersion; created: boolean } => {
  const parent = currentVersion(record);

  if (parent && parent.markdown === input.markdown)
    return { record, version: parent, created: false };

  const id = newId();
  const version: ResumeVersion = {
    id,
    resumeId: input.resumeId,
    parentId: parent?.id ?? null,
    baseId: parent ? parent.baseId : id,
    // ponytail: English default label, renameable in the picker — same class of
    // thing as the untranslated default resume name.
    label: input.label ?? (parent ? `v${record.versions.length + 1}` : "Base v1"),
    markdown: input.markdown,
    jobTarget: input.jobTarget,
    summary: diffSummary(parent?.markdown ?? "", input.markdown),
    createdAt: new Date().toISOString()
  };

  return {
    record: { currentId: id, versions: [...record.versions, version] },
    version,
    created: true
  };
};

/** One line of lineage for the agent's system prompt and for status text. */
export const lineageSummary = (record: VersionRecord, markdown: string): string => {
  const current = currentVersion(record);
  if (!current) return "No version has been saved yet.";

  const dirty = current.markdown !== markdown;
  return [
    `Current version: ${current.label}.`,
    `Based on: ${parentVersion(record, current)?.label ?? "nothing, it is the root"}.`,
    `Base: ${baseVersion(record, current)?.label ?? "unknown"}.`,
    current.jobTarget ? `Target job: ${current.jobTarget}.` : "",
    dirty
      ? "The document has edits that are not in any version yet."
      : "The document matches the current version."
  ]
    .filter(Boolean)
    .join(" ");
};

export const getVersionRecord = async (
  resumeId: string | null
): Promise<VersionRecord> => {
  if (!isClient || !resumeId) return emptyRecord();
  try {
    const stored = await localForage.getItem<VersionRecord>(versionsKey(resumeId));
    return stored ?? emptyRecord();
  } catch {
    return emptyRecord();
  }
};

const writeRecord = async (resumeId: string, record: VersionRecord) => {
  await localForage.setItem(versionsKey(resumeId), record);
  versionsRev.value++;
};

/** Save a version of the resume as it stands. Returns null when nothing changed. */
export const saveVersion = async (
  resumeId: string,
  markdown: string,
  opts: { label?: string; jobTarget?: string } = {}
): Promise<ResumeVersion | null> => {
  const current = await getVersionRecord(resumeId);
  const { record, version, created } = appendVersion(current, {
    resumeId,
    markdown,
    ...opts
  });
  if (!created) return null;

  await writeRecord(resumeId, record);
  return version;
};

const mutate = async (
  resumeId: string,
  fn: (record: VersionRecord) => VersionRecord | null
) => {
  const record = await getVersionRecord(resumeId);
  const next = fn(record);
  if (next) await writeRecord(resumeId, next);
};

/** Move the current pointer. Editing from here creates a branch off that node. */
export const setCurrentVersion = (resumeId: string, versionId: string) =>
  mutate(resumeId, (record) =>
    findVersion(record, versionId) ? { ...record, currentId: versionId } : null
  );

export const renameVersion = (resumeId: string, versionId: string, label: string) =>
  mutate(resumeId, (record) => ({
    ...record,
    versions: record.versions.map((v) => (v.id === versionId ? { ...v, label } : v))
  }));

/** Promote a version to a base. Existing branches keep the base they were cut from. */
export const markAsBase = (resumeId: string, versionId: string) =>
  mutate(resumeId, (record) => ({
    ...record,
    versions: record.versions.map((v) =>
      v.id === versionId ? { ...v, baseId: v.id } : v
    )
  }));

export const deleteVersionHistory = (resumeId: string) =>
  localForage.removeItem(versionsKey(resumeId));

/** Every resume's history — for "erase all content". */
export const clearAllVersionHistory = async () => {
  const keys = await localForage.keys();
  await Promise.all(
    keys
      .filter((k) => k.startsWith(VERSIONS_PREFIX))
      .map((k) => localForage.removeItem(k))
  );
};
