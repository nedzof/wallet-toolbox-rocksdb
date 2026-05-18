import { EventBus } from '../../src/events/EventBus'
import { CacheInvalidationConsumer } from '../../src/messaging/consumers/CacheInvalidationConsumer'
import { CacheInvalidationMessage } from '../../src/messaging/messages'

describe('CacheInvalidationConsumer', () => {
  test('applies block, UTXO, and reorg invalidation before ACK', () => {
    const order: string[] = []
    const target = {
      invalidateByBlock: jest.fn(() => {
        order.push('block')
        return 1
      }),
      invalidateOutpoints: jest.fn(() => {
        order.push('utxo')
        return 2
      }),
      clear: jest.fn(() => {
        order.push('clear')
      })
    }
    const consumer = new CacheInvalidationConsumer(target, new EventBus())

    consumer.processJetStreamMessage(makeAckable(makeMessage({ type: 'block', blockHeight: 1, outpoints: ['tx.0'] }), order))
    consumer.processJetStreamMessage(makeAckable(makeMessage({ type: 'utxo', outpoints: ['tx.1'] }), order))
    consumer.processJetStreamMessage(makeAckable(makeMessage({ type: 'reorg', reorgDepth: 1 }), order))

    expect(order).toEqual(['block', 'ack', 'utxo', 'ack', 'clear', 'ack'])
    expect(target.invalidateByBlock).toHaveBeenCalledWith(1, ['tx.0'])
    expect(target.invalidateOutpoints).toHaveBeenCalledWith(['tx.1'])
    expect(target.clear).toHaveBeenCalledTimes(1)
  })

  test('terms malformed messages', () => {
    const consumer = new CacheInvalidationConsumer({
      invalidateByBlock: jest.fn(),
      invalidateOutpoints: jest.fn(),
      clear: jest.fn()
    })
    const ackable = makeAckable(makeMessage({ type: 'utxo' }), [])

    consumer.processJetStreamMessage(ackable)

    expect(ackable.term).toHaveBeenCalled()
    expect(ackable.ack).not.toHaveBeenCalled()
  })
})

function makeMessage (overrides: Partial<CacheInvalidationMessage>): CacheInvalidationMessage {
  return {
    messageId: 'msg',
    idempotencyKey: 'key',
    createdAtMs: Date.now(),
    schemaVersion: 1,
    source: 'test',
    chain: 'test',
    type: 'utxo',
    ...overrides
  }
}

function makeAckable (message: unknown, order: string[]): any {
  return {
    json: jest.fn(() => message),
    ack: jest.fn(() => { order.push('ack') }),
    nak: jest.fn(),
    term: jest.fn()
  }
}
