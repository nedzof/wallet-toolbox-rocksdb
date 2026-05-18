import { Beef } from '@bsv/sdk'

import { BroadcastConsumer, classifyBroadcastResults } from '../../src/messaging/consumers/BroadcastConsumer'
import { TxBroadcastMessage } from '../../src/messaging/messages'
import { PostBeefResult } from '../../src/sdk/WalletServices.interfaces'

describe('BroadcastConsumer JetStream adapter', () => {
  test('ACKs only after provider broadcast and durable attempt recording', async () => {
    const order: string[] = []
    const results: PostBeefResult[] = [{
      name: 'provider',
      status: 'success',
      txidResults: [{ txid: 'a'.repeat(64), status: 'success' }]
    }]
    const services = {
      postBeef: jest.fn(async () => {
        order.push('broadcast')
        return results
      })
    }
    const consumer = BroadcastConsumer.fromServices(services, { concurrency: 1 })
    const recorder = {
      recordBroadcastAttempt: jest.fn(async record => {
        expect(record.outcome).toBe('accepted')
        order.push('record')
      })
    }
    const ackable = makeAckable(makeMessage(), order)

    await expect(consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => ({ beef: new Beef(), txid: 'a'.repeat(64) })) },
      recorder
    )).resolves.toBe(results)

    expect(order).toEqual(['broadcast', 'record', 'ack'])
    expect(ackable.nak).not.toHaveBeenCalled()
    expect(ackable.term).not.toHaveBeenCalled()
    await consumer.close()
  })

  test('dead-letters malformed messages without provider broadcast', async () => {
    const services = { postBeef: jest.fn(async () => [] as PostBeefResult[]) }
    const consumer = BroadcastConsumer.fromServices(services)
    const ackable = makeAckable({ ...makeMessage(), rawTxHex: '00' } as unknown as TxBroadcastMessage)
    const deadLetterPublisher = { publishBroadcastDeadLetter: jest.fn(async () => undefined) }

    await consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => ({ beef: new Beef(), txid: 'a'.repeat(64) })) },
      { recordBroadcastAttempt: jest.fn(async () => undefined) },
      { deadLetterPublisher }
    )

    expect(services.postBeef).not.toHaveBeenCalled()
    expect(deadLetterPublisher.publishBroadcastDeadLetter).toHaveBeenCalledWith(expect.objectContaining({
      originalStream: 'TX_BROADCAST',
      originalIdempotencyKey: expect.any(String),
      reason: expect.stringContaining('rawTxHex')
    }))
    expect(ackable.term).toHaveBeenCalled()
    expect(ackable.ack).not.toHaveBeenCalled()
    expect(ackable.nak).not.toHaveBeenCalled()
    await consumer.close()
  })

  test('NACKs retryable internal failures', async () => {
    const consumer = BroadcastConsumer.fromServices({ postBeef: jest.fn(async () => [] as PostBeefResult[]) })
    const ackable = makeAckable(makeMessage())

    await consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => { throw new Error('rocksdb write failed') }) },
      { recordBroadcastAttempt: jest.fn(async () => undefined) }
    )

    expect(ackable.nak).toHaveBeenCalledTimes(1)
    expect(ackable.ack).not.toHaveBeenCalled()
    expect(ackable.term).not.toHaveBeenCalled()
    await consumer.close()
  })

  test('records retryable provider outcomes before NACKing with backoff', async () => {
    const results: PostBeefResult[] = [{
      name: 'provider',
      status: 'error',
      txidResults: [{
        txid: 'a'.repeat(64),
        status: 'error',
        serviceError: true,
        data: { code: 429 }
      }]
    }]
    const consumer = BroadcastConsumer.fromServices({ postBeef: jest.fn(async () => results) })
    const recorder = { recordBroadcastAttempt: jest.fn(async () => undefined) }
    const ackable = makeAckable(makeMessage())

    await consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => ({ beef: new Beef(), txid: 'a'.repeat(64) })) },
      recorder,
      { retryBackoffMs: 2500 }
    )

    expect(recorder.recordBroadcastAttempt).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'rate_limited' }))
    expect(ackable.nak).toHaveBeenCalledWith(2500)
    expect(ackable.ack).not.toHaveBeenCalled()
    expect(ackable.term).not.toHaveBeenCalled()
    await consumer.close()
  })

  test('dead-letters retryable failures on max delivery instead of NACKing again', async () => {
    const consumer = BroadcastConsumer.fromServices({ postBeef: jest.fn(async () => [] as PostBeefResult[]) })
    const ackable = makeAckable(makeMessage()) as ReturnType<typeof makeAckable> & { info: { deliveryCount: number } }
    ackable.info = { deliveryCount: 3 }
    const deadLetterPublisher = { publishBroadcastDeadLetter: jest.fn(async () => undefined) }

    await consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => { throw new Error('rocksdb write failed') }) },
      { recordBroadcastAttempt: jest.fn(async () => undefined) },
      { deadLetterPublisher, maxDeliver: 3 }
    )

    expect(deadLetterPublisher.publishBroadcastDeadLetter).toHaveBeenCalledWith(expect.objectContaining({
      originalStream: 'TX_BROADCAST',
      originalTxid: 'a'.repeat(64),
      deliveryCount: 3,
      reason: 'rocksdb write failed'
    }))
    expect(ackable.term).toHaveBeenCalledTimes(1)
    expect(ackable.nak).not.toHaveBeenCalled()
    expect(ackable.ack).not.toHaveBeenCalled()
    await consumer.close()
  })

  test('classifies provider outcomes including unknown without blind retry', () => {
    expect(classifyBroadcastResults([], 'a'.repeat(64))).toBe('unknown')
    expect(classifyBroadcastResults([{
      name: 'provider',
      status: 'success',
      txidResults: [{ txid: 'a'.repeat(64), status: 'success', alreadyKnown: true }]
    }], 'a'.repeat(64))).toBe('already_seen')
    expect(classifyBroadcastResults([{
      name: 'provider',
      status: 'error',
      txidResults: [{ txid: 'a'.repeat(64), status: 'error', doubleSpend: true }]
    }], 'a'.repeat(64))).toBe('rejected_terminal')
  })
})

function makeMessage (): TxBroadcastMessage {
  return {
    messageId: 'msg-1',
    idempotencyKey: `test:storage:broadcast:1:${'a'.repeat(64)}:1`,
    createdAtMs: Date.now(),
    schemaVersion: 1,
    source: 'test',
    chain: 'test',
    txid: 'a'.repeat(64),
    rawTxHash: 'a'.repeat(64),
    attempt: 1,
    priority: 1,
    walletStorageIdentityKey: 'storage',
    provenTxReqId: 1
  }
}

function makeAckable (message: unknown, order?: string[]): any {
  return {
    json: jest.fn(() => message),
    ack: jest.fn(() => { order?.push('ack') }),
    nak: jest.fn(),
    term: jest.fn()
  }
}
