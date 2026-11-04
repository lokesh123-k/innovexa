import type { AxiosError } from 'axios';
import axios, { type InternalAxiosRequestConfig } from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}

interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: { path: string; message: string }[] };
}

/** Auth endpoints that must never trigger a refresh-and-retry loop. */
const NO_RETRY =
  /\/auth\/(login|refresh|logout|accept-invitation|forgot-password|reset-password|verify-email)/;
const REFRESHABLE = new Set(['TOKEN_EXPIRED', 'UNAUTHENTICATED']);

let refreshing: Promise<void> | null = null;
let onSessionExpired: (() => void) | undefined;
/**
 * Set once a refresh has failed: there is no valid refresh session, so further
 * 401s go straight to the sign-in page instead of retrying refresh. Cleared by
 * any successful API response (e.g. after signing in again).
 */
let sessionEnded = false;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

api.interceptors.response.use(
  (response) => {
    sessionEnded = false;
    return response;
  },
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as
      (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.error?.code;
    if (
      original &&
      error.response?.status === 401 &&
      code &&
      REFRESHABLE.has(code) &&
      !sessionEnded &&
      !original._retried &&
      !NO_RETRY.test(original.url ?? '')
    ) {
      original._retried = true;
      // Single-flight: concurrent 401s share one refresh, so rotation never trips reuse detection.
      refreshing ??= api
        .post('/auth/refresh')
        .then(
          () => undefined,
          (err: unknown) => {
            // Flag before releasing the single-flight slot, so no 401 can slip in between.
            sessionEnded = true;
            throw err;
          },
        )
        .finally(() => {
          refreshing = null;
        });
      try {
        await refreshing;
        return api(original);
      } catch {
        sessionEnded = true;
        onSessionExpired?.();
      }
    }
    throw error;
  },
);

/** Human-readable message for any API or network error. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    if (!error.response) return 'Cannot reach the server. Check that the API is running.';
    const message = error.response.data?.error?.message;
    // A 5xx without the API's JSON envelope comes from the dev proxy: the API is down.
    if (!message && error.response.status >= 500) {
      return 'Cannot reach the Innovexa API. Make sure the API server is running, then try again.';
    }
    return message ?? fallback;
  }
  return fallback;
}

export function errorCode(error: unknown): string | undefined {
  return axios.isAxiosError<ApiErrorBody>(error) ? error.response?.data?.error?.code : undefined;
}

export function errorDetails(error: unknown): unknown {
  return axios.isAxiosError<ApiErrorBody>(error) ? error.response?.data?.error?.details : undefined;
}

export async function getData<T>(url: string, params?: object): Promise<ApiEnvelope<T>> {
  const res = await api.get<ApiEnvelope<T>>(url, { params });
  return res.data;
}

export async function postData<T>(url: string, body?: unknown): Promise<T> {
  return (await api.post<ApiEnvelope<T>>(url, body)).data.data;
}

export async function patchData<T>(url: string, body?: unknown): Promise<T> {
  return (await api.patch<ApiEnvelope<T>>(url, body)).data.data;
}

export async function putData<T>(url: string, body?: unknown): Promise<T> {
  return (await api.put<ApiEnvelope<T>>(url, body)).data.data;
}

export async function deleteData<T>(url: string): Promise<T> {
  return (await api.delete<ApiEnvelope<T>>(url)).data.data;
}

/** Uploads one file to a parent record (task, project, conversation…) and returns its id. */
export async function uploadFile(
  file: File,
  kind: 'PROJECT' | 'TASK' | 'CHANGE_REQUEST' | 'CONVERSATION' | 'WORK_REPORT',
  refId: string,
  visibility?: 'INTERNAL' | 'CLIENT',
) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('refId', refId);
  if (visibility) form.append('visibility', visibility);
  form.append('file', file);
  const res = await api.post<ApiEnvelope<{ id: string; name: string; url: string }>>(
    '/files',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return res.data.data;
}

/** API file URLs are absolute paths (/api/v1/...); in dev they go through the Vite proxy. */
export const fileHref = (url: string) => url;
