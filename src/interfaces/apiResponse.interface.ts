export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponseSuccess<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiResponseError {
  success: false;
  error: ApiErrorDetail;
  timestamp: string;
  path: string;
}

export type ApiResponse<T> = ApiResponseSuccess<T> | ApiResponseError;
