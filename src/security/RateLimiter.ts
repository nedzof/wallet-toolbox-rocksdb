export interface RateLimitState {
  count: number
  resetTime: number
}

export class RateLimiter {
  private readonly limits = new Map<number | string, RateLimitState>()

  checkLimit (userId: number | string, maxRequests: number, windowMs: number): boolean {
    if (!Number.isSafeInteger(maxRequests) || maxRequests <= 0) throw new Error('RATE_LIMIT_MAX_REQUESTS_INVALID')
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error('RATE_LIMIT_WINDOW_INVALID')

    const now = Date.now()
    const userLimit = this.limits.get(userId)

    if (userLimit == null || now >= userLimit.resetTime) {
      this.limits.set(userId, { count: 1, resetTime: now + windowMs })
      return true
    }

    if (userLimit.count >= maxRequests) return false

    userLimit.count++
    return true
  }

  reset (userId?: number | string): void {
    if (userId === undefined) this.limits.clear()
    else this.limits.delete(userId)
  }

  getState (userId: number | string): RateLimitState | undefined {
    const state = this.limits.get(userId)
    return state == null ? undefined : { ...state }
  }
}
