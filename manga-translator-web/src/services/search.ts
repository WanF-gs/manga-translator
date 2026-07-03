/**
 * 跨作品搜索 & 学习 API 服务
 * 对接后端 reader_service (端口 8006)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface SearchResult {
  result_id: string;
  project_id: string;
  project_name: string;
  chapter_name: string;
  page_id: string;
  page_number: number;
  region_id?: string;
  matched_text: string;
  context_before: string;
  context_after: string;
  match_type: 'exact' | 'fuzzy' | 'semantic';
  score: number;
}

export interface SearchParams {
  q: string;
  language?: string;
  project_id?: string;
  match_type?: 'exact' | 'fuzzy' | 'all';
  page?: number;
  page_size?: number;
}

export interface LearningProgress {
  progress_id: string;
  user_id: string;
  word: string;
  language: string;
  mastery_level: number; // 0-5 (Ebbinghaus)
  next_review_at: string;
  review_count: number;
  last_reviewed_at?: string;
  created_at: string;
}

export interface Achievement {
  achievement_id: string;
  name: string;
  description: string;
  icon: string;
  condition_type: string;
  condition_value: number;
}

export interface UserAchievement {
  user_achievement_id: string;
  achievement: Achievement;
  progress: number;
  completed: boolean;
  completed_at?: string;
}

export interface ReviewWord {
  progress_id: string;
  vocab_id: string;
  word: string;
  reading: string;
  meaning: string;
  translation: string;
  part_of_speech: string;
  mastery_level: number;
  review_count: number;
  last_review_at: string;
  next_review_at: string;
  streak_days: number;
}

export interface ReviewSession {
  items: ReviewWord[];
  total: number;
}

export const searchApi = {
  /** 跨作品全文搜索 */
  search: (params: SearchParams) =>
    request.get<ApiResponse<{ items: SearchResult[]; total: number }>>('/search', { params }),

  /** 获取搜索结果上下文 */
  getContext: (resultId: string) =>
    request.get<ApiResponse<{ page_url: string; region_bounds: number[] }>>(
      `/search/${resultId}/context`
    ),
};

export const learnApi = {
  /** 获取学习进度列表 */
  getProgress: (language?: string) =>
    request.get<ApiResponse<{ items: LearningProgress[]; total: number }>>('/learn/progress', {
      params: language ? { language } : {},
    }),

  /** 更新单词掌握度 */
  updateProgress: (progressId: string, masteryLevel: number) =>
    request.put<ApiResponse<LearningProgress>>(`/learn/progress/${progressId}`, {
      mastery_level: masteryLevel,
    }),

  /** 记录单词复习（更新艾宾浩斯遗忘曲线） */
  reviewVocab: (vocabId: string) =>
    request.post<ApiResponse<{ vocab_id: string; review_count: number; mastery_level: number; next_review_at: string }>>(`/learn/review/${vocabId}`),

  /** 获取复习会话 */
  getReview: (language: string, count?: number) =>
    request.get<ApiResponse<ReviewSession>>('/learn/review', {
      params: { language, count: count ?? 10 },
    }),

  /** 获取成就列表 */
  getAchievements: () =>
    request.get<ApiResponse<{ items: UserAchievement[]; total: number }>>('/learn/achievements'),

  /** 获取单词统计数据 */
  getWordStats: () =>
    request.get<ApiResponse<{
      total_words: number;
      mastered: number;
      reviewing: number;
      new_words: number;
    }>>('/learn/stats'),
};
