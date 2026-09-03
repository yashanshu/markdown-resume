export type PaperType = keyof typeof PAPER;

export type ResumeStyles = {
  marginV: number;
  marginH: number;
  lineHeight: number;
  paragraphSpace: number;
  themeColor: string;
  fontCJK: Font;
  fontEN: Font;
  fontSize: number;
  paper: PaperType;
};

export type SystemData = {
  mdContent: string;
  cssContent: string;
  mdFlag: boolean;
  cssFlag: boolean;
  curResumeId: string | null;
  curResumeName: string;
};

export type ToastFlagData = {
  save: boolean;
  delete: boolean | string;
  switch: boolean | string;
  new: boolean;
  duplicate: boolean | string;
  correct: boolean | number;
  import: boolean | "yes" | "no";
};

export type ResumeHeaderItem = {
  readonly text: string;
  readonly link?: string;
  readonly newLine?: boolean;
};

export type ResumeFrontMatter = {
  readonly name?: string;
  readonly header?: Array<ResumeHeaderItem>;
};

export type Font = {
  readonly name: string;
  readonly fontFamily?: string;
};

export type ResumeStorageItem = {
  name: string;
  markdown: string;
  css: string;
  styles: ResumeStyles;
  update: string;
};

/** A saved point in one resume's history. Markdown only — styles are presentation. */
export type ResumeVersion = {
  id: string;
  resumeId: string;
  parentId: string | null; // immediate predecessor
  baseId: string; // nearest ancestor that is a base; its own id when it is one
  label: string; // "Base v1", "Backend Engineer · A"
  markdown: string;
  jobTarget?: string;
  summary?: string; // change summary against the parent
  createdAt: string;
};

export type VersionRecord = {
  currentId: string | null;
  versions: ResumeVersion[];
};

export type ResumeStorage = {
  [id: string]: ResumeStorageItem;
};

export interface ResumeListItem extends ResumeStorageItem {
  id: string;
}

export type DropdownItem = {
  label: string;
  icon?: string;
  link: string;
};

export type ImageStorageItem = {
  name: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type ImageStorage = {
  [id: string]: ImageStorageItem;
};

export interface ImageListItem extends ImageStorageItem {
  id: string;
}

export type ComboboxItem = {
  label: string;
  value: string;
  onSelect: () => void;
};
