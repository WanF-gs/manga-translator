// 页面相关类型定义

export type PageStatus = 'pending' | 'translating' | 'reviewed' | 'completed';

export interface PageData {
  page_id: string;
  chapter_id: string;
  original_url: string;
  processed_url?: string;
  thumbnail_url?: string;
  sort_order: number;
  status: PageStatus;
  width: number;
  height: number;
  file_size: number;
  ocr_result?: OcrResult;
  translation_result?: TranslationResult;
  created_at: string;
  updated_at: string;
}

export interface OcrResult {
  regions: OcrRegion[];
  overall_confidence: number;
  processed_at: string;
}

export interface OcrRegion {
  region_id: string;
  text: string;
  confidence: number;
  /** P0: 字符级置信度数组 (0.0-1.0)，与 text 字符位置对应 */
  char_confidences?: number[];
  language: string;
  has_furigana?: boolean;
}

export interface TranslationResult {
  regions: TranslatedRegion[];
  engine: 'basic' | 'multimodal';
  processed_at: string;
}

export interface TranslatedRegion {
  region_id: string;
  translated_text: string;
  alternative_translations?: string[];
}
