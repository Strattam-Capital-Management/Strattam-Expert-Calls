import type {
  AuthCheckResponse,
  CacheStatsResponse,
  CostEstimate,
  DefaultQuestionsResponse,
  DisambiguationResponse,
  ModelsResponse,
  RunStatusResponse,
  StartRunPayload,
  StartRunResponse,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  code?: string | null;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, code } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (code) headers["X-Access-Code"] = code;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      `Could not reach the server at ${API_BASE}${path}. Is the backend running?`,
      0
    );
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const parsed = data as { error?: string; message?: string } | null;
    const message = parsed?.error || parsed?.message || `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export const api = {
  checkAuth: (code: string) =>
    request<AuthCheckResponse>("/auth/check", { method: "POST", body: { code } }),

  disambiguateCompany: (query: string, code: string) =>
    request<DisambiguationResponse>("/company/disambiguate", {
      method: "POST",
      body: { query },
      code,
    }),

  getDefaultQuestions: (code: string) =>
    request<DefaultQuestionsResponse>("/questions/default", { code }),

  getModels: (code: string) => request<ModelsResponse>("/cost/models", { code }),

  estimateCost: (model: string, code: string) =>
    request<CostEstimate>("/cost/estimate", { method: "POST", body: { model }, code }),

  startRun: (payload: StartRunPayload, code: string) =>
    request<StartRunResponse>("/run/start", { method: "POST", body: payload, code }),

  getRun: (runId: string, code: string) =>
    request<RunStatusResponse>(`/run/${runId}`, { code }),

  getCacheStats: (code: string) => request<CacheStatsResponse>("/cache/stats", { code }),
};

export function exportUrl(runId: string, code: string): string {
  return `${API_BASE}/run/${runId}/export.xlsx?code=${encodeURIComponent(code)}`;
}
