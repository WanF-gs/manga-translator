/**
 * 阅读器 API 服务
 * 对接后端 reader_service
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface ReaderProgress {
  project_id: string;
  current_page: number;
  chapter_id?: string;
  updated_at: string;
}

export interface ReaderPage {
  page_id: string;
  original_url: string;
  processed_url?: string;
  page_number: number;
  sort_order: number;
  regions?: ReaderRegion[];
}

export interface ReaderRegion {
  region_id: string;
  type: string;
  boundary: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  original_text?: string;
  translated_text?: string;
}

export interface WordDefinition {
  word: string;
  reading?: string;
  romaji?: string;
  pos?: string;
  definitions: string[];
  examples: { ja?: string; zh?: string }[];
  source: string;
  message?: string;
}

export interface FuriganaToken {
  surface: string;
  reading: string;
  romaji: string;
}

export interface AnnotateResult {
  text: string;
  romaji: string;
  tokens: FuriganaToken[];
}

export const readerApi = {
  getProgress: (projectId: string, chapterId?: string) =>
    request.get<ApiResponse<ReaderProgress>>(`/reader/progress/${projectId}`, {
      params: chapterId ? { chapter_id: chapterId } : undefined,
    }),

  saveProgress: (projectId: string, currentPage: number, chapterId?: string) =>
    request.put<ApiResponse<null>>(`/reader/progress`, {
      project_id: projectId,
      page_id: String(currentPage),
      chapter_id: chapterId || '',
      scroll_position: 0,
      zoom_level: 1.0,
    }),

  /** 获取章节页面（通过创建/获取阅读会话） */
  getPages: (chapterId: string) =>
    request.get<ApiResponse<ReaderPage[]>>(`/reader/sessions`, {
      params: { chapter_id: chapterId },
    }),

  /** §2.7.4 单词即点即译 */
  lookupWord: (word: string, lang = 'ja') =>
    request.get<ApiResponse<WordDefinition>>(`/reader/dictionary/lookup`, {
      params: { word, lang },
    }),

  /** §2.7.3 振假名/罗马音标注 */
  annotate: (text: string, lang = 'ja') =>
    request.post<ApiResponse<AnnotateResult>>(`/reader/annotate`, { text, lang }),

  /** 加入生词本 */
  addVocab: (payload: { word: string; language: string; reading?: string; meaning: string; part_of_speech?: string; source_project_id?: string; notes?: string }) =>
    request.post<ApiResponse<{ vocab_id: string }>>(`/vocab`, payload),
};
