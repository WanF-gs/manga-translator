// 项目相关类型定义

export type SourceLang = 'ja' | 'zh' | 'en' | 'ko';
export type ProjectStatus = 'active' | 'trashed';

export interface ProjectData {
  project_id: string;
  user_id: string;
  name: string;
  source_lang: SourceLang;
  default_target_lang?: string;
  cover_url?: string;
  is_favorite: boolean;
  status: ProjectStatus;
  trashed_at?: string;
  created_at: string;
  updated_at: string;
  // 聚合字段
  chapter_count?: number;
  page_count?: number;
  completed_count?: number;
}

export interface CreateProjectParams {
  name: string;
  source_lang: SourceLang;
  default_target_lang?: string;
}

export interface UpdateProjectParams {
  name?: string;
  cover_url?: string;
  is_favorite?: boolean;
}

export interface ChapterData {
  chapter_id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  page_count?: number;
}

export interface CreateChapterParams {
  name: string;
}

export interface UpdateChapterParams {
  name?: string;
  sort_order?: number;
}
