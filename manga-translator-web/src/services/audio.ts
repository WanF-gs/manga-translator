/**
 * 音频剧场 & 动态漫画 API 服务
 * 对接后端 export_service (端口 8005)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface TTSVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: 'male' | 'female';
  description: string;
  sample_url?: string;
}

export interface AudioTask {
  task_id: string;
  page_id: string;
  text: string;
  voice_id: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'unknown';
  audio_url?: string;
  duration?: number;
  error?: string;
  created_at: string;
}

export interface SoundEffect {
  effect_id: string;
  name: string;
  category: string;
  description: string;
  preview_url?: string;
}

export interface DynamicMangaTask {
  task_id: string;
  chapter_id: string;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'unknown';
  video_url?: string;
  duration?: number;
  progress: number;
  error?: string;
  created_at: string;
}

export const audioApi = {
  /** 获取 TTS 语音列表 */
  getVoices: (language?: string) =>
    request.get<ApiResponse<TTSVoice[]>>('/audio/voices', {
      params: language ? { language } : {},
    }),

  /** 生成音频 */
  generate: (data: { page_id: string; voice_id: string; text: string }) =>
    request.post<ApiResponse<AudioTask>>('/audio/generate', data),

  /** 获取音频任务状态 */
  getTaskStatus: (taskId: string) =>
    request.get<ApiResponse<AudioTask>>(`/audio/status/${taskId}`),

  /** 获取音效列表 */
  getSoundEffects: (category?: string) =>
    request.get<ApiResponse<SoundEffect[]>>('/audio/effects', {
      params: category ? { category } : {},
    }),
};

export const dynamicMangaApi = {
  /** 生成动态漫画 */
  generate: (chapterId: string, options?: { add_audio?: boolean; add_effects?: boolean }) =>
    request.post<ApiResponse<DynamicMangaTask>>('/dynamic-manga/generate', {
      chapter_id: chapterId,
      ...options,
    }),

  /** 获取动态漫画任务状态 */
  getTaskStatus: (taskId: string) =>
    request.get<ApiResponse<DynamicMangaTask>>(`/dynamic-manga/status/${taskId}`),
};
