import { RateLimiter } from '../../src/security/RateLimiter'

describe('RateLimiter', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('allows requests up to the limit within a window', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000)
    const limiter = new RateLimiter()

    expect(limiter.checkLimit(7, 2, 1000)).toBe(true)
    expect(limiter.checkLimit(7, 2, 1000)).toBe(true)
    expect(limiter.checkLimit(7, 2, 1000)).toBe(false)
    expect(limiter.getState(7)).toEqual({ count: 2, resetTime: 2000 })
  })

  test('resets the counter after the window expires', () => {
    const now = jest.spyOn(Date, 'now')
    const limiter = new RateLimiter()

    now.mockReturnValue(1000)
    expect(limiter.checkLimit('user-a', 1, 500)).toBe(true)
    expect(limiter.checkLimit('user-a', 1, 500)).toBe(false)

    now.mockReturnValue(1500)
    expect(limiter.checkLimit('user-a', 1, 500)).toBe(true)
    expect(limiter.getState('user-a')).toEqual({ count: 1, resetTime: 2000 })
  })

  test('tracks users independently and supports explicit reset', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000)
    const limiter = new RateLimiter()

    expect(limiter.checkLimit(1, 1, 1000)).toBe(true)
    expect(limiter.checkLimit(2, 1, 1000)).toBe(true)
    expect(limiter.checkLimit(1, 1, 1000)).toBe(false)

    limiter.reset(1)
    expect(limiter.checkLimit(1, 1, 1000)).toBe(true)

    limiter.reset()
    expect(limiter.getState(1)).toBeUndefined()
    expect(limiter.getState(2)).toBeUndefined()
  })

  test('rejects invalid limits', () => {
    const limiter = new RateLimiter()

    expect(() => limiter.checkLimit(1, 0, 1000)).toThrow('RATE_LIMIT_MAX_REQUESTS_INVALID')
    expect(() => limiter.checkLimit(1, 1, 0)).toThrow('RATE_LIMIT_WINDOW_INVALID')
  })
})
