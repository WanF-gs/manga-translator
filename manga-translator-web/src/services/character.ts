/**
 * 角色管理 API 服务
 * 对接后端 translation_service (端口 8003)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export type ToneType =
  | 'tsundere'
  | 'hotblooded'
  | 'calm'
  | 'cold'
  | 'loli'
  | 'genki'
  | 'lazy'
  | 'chuunibyou'
  | 'natural'
  | 'bellyblack'
  | 'custom';

export interface CustomToneParams {
  formality?: number;   // 0-100, 正式程度
  emotion?: number;     // 0-100, 情感强度
  sentence_length?: number; // 1-5, 句子长度偏好
  honorific_weight?: number; // 1-5, 敬语权重
}

export interface CharacterData {
  character_id: string;
  project_id: string;
  name: string;
  tone_type: ToneType;
  custom_tone_params?: CustomToneParams;
  catchphrase?: string;
  honorific_level: number; // 1-5
  gender: 'male' | 'female' | 'unknown';
  visual_features?: string;
  voice_id?: string;
  font_id?: string;
  created_at: string;
}

export interface CreateCharacterParams {
  name: string;
  tone_type: ToneType;
  custom_tone_params?: CustomToneParams;
  catchphrase?: string;
  honorific_level?: number;
  gender?: string;
  visual_features?: string;
  voice_id?: string;
  font_id?: string;
}

export interface AutoDetectParams {
  text_sample: string;
}

export interface AutoDetectResult {
  suggested_tone: ToneType;
  confidence: number;
  suggestions: Array<{ tone: ToneType; score: number }>;
}

export const characterApi = {
  /** 获取作品角色列表 */
  getList: (projectId: string) =>
    request.get<ApiResponse<CharacterData[]>>(`/characters`, {
      params: { project_id: projectId },
    }),

  /** 创建角色 */
  create: (projectId: string, data: CreateCharacterParams) =>
    request.post<ApiResponse<CharacterData>>('/characters', {
      project_id: projectId,
      ...data,
    }),

  /** 更新角色 */
  update: (characterId: string, data: Partial<CharacterData>) =>
    request.put<ApiResponse<CharacterData>>(`/characters/${characterId}`, data),

  /** 删除角色 */
  delete: (characterId: string) =>
    request.delete<ApiResponse<null>>(`/characters/${characterId}`),

  /** 自动检测角色语气 */
  autoDetect: (data: AutoDetectParams) =>
    request.post<ApiResponse<AutoDetectResult>>('/characters/auto-detect', data),
};
