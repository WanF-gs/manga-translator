// API统一响应格式

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  request_id: string;
  timestamp?: string;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiError {
  code: number;
  message: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
  request_id: string;
}

// 错误码
export enum ErrorCode {
  SUCCESS = 0,
  PARAM_INVALID = 1001,
  RESOURCE_NOT_FOUND = 1002,
  PERMISSION_DENIED = 1003,
  FREE_LIMIT = 1004,
  FORMAT_NOT_SUPPORTED = 1005,
  FILE_TOO_LARGE = 1006,
  AUTH_FAILED = 2001,
  TOKEN_EXPIRED = 2002,
  TOKEN_INVALID = 2003,
  DETECT_FAILED = 3001,
  OCR_FAILED = 3002,
  TRANSLATE_FAILED = 3003,
  INPAINT_FAILED = 3004,
  RENDER_FAILED = 3005,
  SERVER_ERROR = 5000,
  SERVICE_UNAVAILABLE = 5001,
}
