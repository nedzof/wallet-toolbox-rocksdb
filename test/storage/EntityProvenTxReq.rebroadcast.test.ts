import { EntityProvenTxReq } from '../../src/storage/schema/entities'

describe('EntityProvenTxReq rebroadcast state', () => {
  test('marks never-broadcast proof timeouts invalid without rebroadcasting', () => {
    const req = makeReq()
    req.status = 'unknown'
    req.attempts = 50
    req.notified = true

    const result = req.applyProofTimeout(3)

    expect(result).toEqual({ action: 'invalid', rebroadcastAttempts: 0 })
    expect(req.status).toBe('invalid')
    expect(req.rebroadcastAttempts).toBe(0)
    expect(req.notified).toBe(false)
    expect(req.wasBroadcast).toBe(false)
  })

  test('resets broadcast transactions to unsent until the rebroadcast limit is reached', () => {
    const req = makeReq()
    req.status = 'unmined'
    req.attempts = 50
    req.notified = true

    const first = req.applyProofTimeout(2)

    expect(first).toEqual({ action: 'rebroadcast', rebroadcastAttempts: 1 })
    expect(req.status).toBe('unsent')
    expect(req.attempts).toBe(0)
    expect(req.notified).toBe(false)
    expect(req.wasBroadcast).toBe(true)

    req.attempts = 50
    const second = req.applyProofTimeout(2)

    expect(second).toEqual({ action: 'rebroadcast', rebroadcastAttempts: 2 })
    expect(req.status).toBe('unsent')
    expect(req.rebroadcastAttempts).toBe(2)

    req.attempts = 50
    const third = req.applyProofTimeout(2)

    expect(third).toEqual({ action: 'invalid', rebroadcastAttempts: 2 })
    expect(req.status).toBe('invalid')
    expect(req.rebroadcastAttempts).toBe(2)
  })

  test('persists broadcast state through dynamic property updates', async () => {
    const neverBroadcast = makeReq()
    neverBroadcast.status = 'unknown'
    neverBroadcast.applyProofTimeout(3)
    const broadcast = makeReq()
    broadcast.status = 'unmined'
    broadcast.applyProofTimeout(3)
    const storage = {
      isStorageProvider: () => true,
      updateProvenTxReqDynamics: jest.fn(async () => 1)
    }

    await neverBroadcast.updateStorageDynamicProperties(storage as any)
    await broadcast.updateStorageDynamicProperties(storage as any)

    expect(storage.updateProvenTxReqDynamics).toHaveBeenNthCalledWith(
      1,
      0,
      expect.objectContaining({
        status: 'invalid',
        wasBroadcast: false,
        rebroadcastAttempts: 0
      }),
      undefined
    )
    expect(storage.updateProvenTxReqDynamics).toHaveBeenNthCalledWith(
      2,
      0,
      expect.objectContaining({
        status: 'unsent',
        attempts: 0,
        wasBroadcast: true,
        rebroadcastAttempts: 1
      }),
      undefined
    )
  })
})

function makeReq (): EntityProvenTxReq {
  return EntityProvenTxReq.fromTxid('11'.repeat(32), [])
}
