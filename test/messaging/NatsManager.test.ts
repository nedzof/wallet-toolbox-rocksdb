import { NatsManager, NATS_STREAM_DEFINITIONS } from '../../src/messaging/NatsManager'

describe('NatsManager', () => {
  test('creates missing streams idempotently and updates existing streams', async () => {
    const add = jest.fn(async () => ({}))
    const update = jest.fn(async () => ({}))
    const info = jest.fn(async (name: string) => {
      if (name === 'TX_BROADCAST') return {}
      throw new Error('stream not found')
    })
    const manager = new NatsManager({
      jetstreamManager: {
        streams: { add, update, info },
        consumers: {}
      } as any
    })

    await manager.initializeStreams()

    expect(update).toHaveBeenCalledWith('TX_BROADCAST', expect.objectContaining({
      name: 'TX_BROADCAST',
      subjects: NATS_STREAM_DEFINITIONS.TX_BROADCAST.subjects
    }))
    expect(add).toHaveBeenCalledTimes(5)
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ name: 'CACHE_INVALIDATE' }))
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ name: 'DEAD_LETTER' }))
  })

  test('publishes JSON with the idempotency key as Nats-Msg-Id', async () => {
    const publish = jest.fn(async () => ({ stream: 'TX_BROADCAST', seq: 1, duplicate: false }))
    const manager = new NatsManager({
      jetstream: { publish } as any
    })
    const message = { idempotencyKey: 'msg-key', payload: 'value' }

    await expect(manager.publishJson('tx.broadcast.test', message)).resolves.toEqual({
      stream: 'TX_BROADCAST',
      seq: 1,
      duplicate: false
    })

    expect(publish).toHaveBeenCalledWith(
      'tx.broadcast.test',
      expect.any(Uint8Array),
      expect.objectContaining({ msgID: 'msg-key' })
    )
    const payload = (publish as jest.Mock).mock.calls[0][1] as Uint8Array
    expect(JSON.parse(Buffer.from(payload).toString('utf8'))).toEqual(message)
  })

  test('publishes broadcast dead letters without raw transaction bytes', async () => {
    const publish = jest.fn(async () => ({ stream: 'DEAD_LETTER', seq: 1, duplicate: false }))
    const manager = new NatsManager({
      jetstream: { publish } as any
    })

    await manager.publishBroadcastDeadLetter({
      messageId: 'msg',
      idempotencyKey: 'deadletter-key',
      createdAtMs: Date.now(),
      schemaVersion: 1,
      source: 'test',
      chain: 'test',
      originalStream: 'TX_BROADCAST',
      originalSubject: 'tx.broadcast.test',
      originalMessageId: 'original',
      originalIdempotencyKey: 'original-key',
      originalTxid: 'a'.repeat(64),
      originalProvenTxReqId: 1,
      reason: 'malformed',
      deliveryCount: 1,
      failedAt: new Date().toISOString()
    })

    expect(publish).toHaveBeenCalledWith(
      'deadletter.tx.broadcast.test',
      expect.any(Uint8Array),
      expect.objectContaining({ msgID: 'deadletter-key' })
    )
    const payload = JSON.parse(Buffer.from((publish as jest.Mock).mock.calls[0][1] as Uint8Array).toString('utf8'))
    expect(payload.rawTxHex).toBeUndefined()
    expect(payload.rawTx).toBeUndefined()
  })

  test('ensures durable consumers and reports connection health', async () => {
    const consumerInfo = jest.fn(async () => { throw new Error('consumer not found') })
    const addConsumer = jest.fn(async () => ({}))
    const connection = {
      isClosed: jest.fn(() => false),
      isDraining: jest.fn(() => false),
      getServer: jest.fn(() => 'nats://localhost:4222'),
      drain: jest.fn(async () => undefined)
    }
    const manager = new NatsManager({
      connection: connection as any,
      jetstreamManager: {
        streams: {},
        consumers: { info: consumerInfo, add: addConsumer }
      } as any
    })

    await manager.ensureConsumer('TX_BROADCAST')

    expect(addConsumer).toHaveBeenCalledWith('TX_BROADCAST', expect.objectContaining({
      durable_name: 'broadcast-workers',
      max_deliver: 3,
      max_ack_pending: 500
    }))
    expect(manager.health()).toEqual({
      connected: true,
      draining: false,
      closed: false,
      server: 'nats://localhost:4222'
    })

    await manager.close()
    expect(connection.drain).toHaveBeenCalledTimes(1)
  })
})
