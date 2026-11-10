/** Error HTTP dari API jaringan iklan (semua adapter). */
export class NetworkApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
  }
  /** 401/403 = token salah/dicabut → jangan di-retry. */
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
}
