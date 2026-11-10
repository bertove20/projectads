/**
 * Klien OpenRouter (server-side saja). Format request/response mengikuti dokumentasi resmi yang
 * diringkas di docs/providers/openrouter/api-notes-2026-11-11.md.
 */

export interface OrModel {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { max_completion_tokens?: number | null };
  supported_parameters?: string[];
}

export interface OrToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type OrMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OrToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OrTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OrChatRequest {
  model: string;
  messages: OrMessage[];
  tools?: OrTool[];
  tool_choice?: 'auto' | 'none';
  max_completion_tokens?: number;
  temperature?: number;
}

export interface OrChatResponse {
  model?: string;
  choices: { finish_reason?: string; message: { role: 'assistant'; content: string | null; tool_calls?: OrToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number | null };
}

export class OpenRouterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** Layak dicoba ulang dengan model fallback (model tidak tersedia, rate limit, gangguan upstream). */
  get retryable() {
    return this.status === 0 || this.status === 404 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
}

export class OpenRouterClient {
  constructor(
    private readonly base: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      const e = err as Error;
      throw new OpenRouterError(0, e.name === 'TimeoutError' ? 'Model tidak merespons dalam batas waktu' : `Tidak dapat menghubungi OpenRouter: ${e.message}`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* bukan JSON */
    }
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
      // Jangan pernah menyertakan header/key dalam pesan error.
      throw new OpenRouterError(res.status, String(msg).slice(0, 300));
    }
    return data as T;
  }

  async listModels(): Promise<OrModel[]> {
    const out: OrModel[] = [];
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const r = await this.call<{ data?: OrModel[]; links?: { next?: string | null } }>('GET', `/models?limit=500&offset=${offset}`);
      const batch = Array.isArray(r?.data) ? r.data : [];
      out.push(...batch);
      if (!r?.links?.next || batch.length === 0) break;
      offset += batch.length;
    }
    return out;
  }

  chat(req: OrChatRequest): Promise<OrChatResponse> {
    return this.call<OrChatResponse>('POST', '/chat/completions', req);
  }
}
