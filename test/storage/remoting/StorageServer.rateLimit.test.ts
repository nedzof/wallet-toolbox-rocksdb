import { StorageServer } from '../../../src/storage/remoting/StorageServer'
import { RateLimiter } from '../../../src/security/RateLimiter'

describe('StorageServer rate limiting', () => {
  test('passes through when rate limiting is disabled', () => {
    const server = makeServer()
    const next = jest.fn()
    const res = makeResponse()

    server.rateLimitAuthenticatedRequest({ auth: { identityKey: 'user-a' } }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  test('limits authenticated requests per identity key', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000)
    const server = makeServer({ maxRequests: 2, windowMs: 1000 })
    const res = makeResponse()

    server.rateLimitAuthenticatedRequest({ auth: { identityKey: 'user-a' } }, res, jest.fn())
    server.rateLimitAuthenticatedRequest({ auth: { identityKey: 'user-a' } }, res, jest.fn())
    const rejectedNext = jest.fn()
    server.rateLimitAuthenticatedRequest({ auth: { identityKey: 'user-a' } }, res, rejectedNext)

    expect(rejectedNext).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests'
      }
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })
})

function makeServer (rateLimit?: { maxRequests: number, windowMs: number }): any {
  const server = Object.create(StorageServer.prototype)
  server.rateLimit = rateLimit
  server.rateLimiter = new RateLimiter()
  return server
}

function makeResponse (): any {
  return {
    status: jest.fn(function (this: any) { return this }),
    json: jest.fn(function (this: any) { return this })
  }
}
