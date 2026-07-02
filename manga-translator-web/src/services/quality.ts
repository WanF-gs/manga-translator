/**
 * 翻译质量评估 API 服务
 * 对接后端 translation_service (端口 8003)
 */

import request from './request';
import type { ApiResponse } from '@/types';

export interface QualityScore {
  quality_id: string;
  page_id: string;
  project_id: string;
  bleu_score: number;
  meteor_score: number;
  overall_score: number;
  scored_at: string;
}

export interface RadarChartData {
  dimensions: Array<{
    name: string;
    score: number;
    maxScore: number;
  }>;
  labels: string[];
  values: number[];
}

export interface QualityPageRow {
  page_id: string;
  sort_order: number | null;
  overall_score: number | null;
  bleu_score: number | null;
  mt_confidence: number | null;
  term_consistency: number | null;
}

export interface QualitySummary {
  project_id: string;
  total_pages: number;
  scored_pages: number;
  avg_bleu: number | null;
  avg_meteor: number | null;
  avg_overall: number | null;
  avg_mt_confidence?: number | null;
  avg_term_consistency?: number | null;
  radar_data: RadarChartData;
  pages?: QualityPageRow[];
  trend: Array<{ date: string; score: number }>;
}

export const qualityApi = {
  /** 获取单页质量评分 */
  getPageScore: (pageId: string) =>
    request.get<ApiResponse<{ assessments: QualityScore[] }>>(`/quality/page/${pageId}`),

  /** 触发质量评分计算 */
  evaluate: (pageId: string) =>
    request.post<ApiResponse<QualityScore>>(`/quality/assess/${pageId}`),

  /** 获取项目质量总览 */
  getProjectSummary: (projectId: string) =>
    request.get<ApiResponse<QualitySummary>>(`/quality/summary/project/${projectId}`),

  /** 批量评估 */
  batchEvaluate: (pageIds: string[]) =>
    request.post<ApiResponse<{ task_id: string; results: QualityScore[] }>>('/quality/batch-assess', {
      page_ids: pageIds,
    }),
};
