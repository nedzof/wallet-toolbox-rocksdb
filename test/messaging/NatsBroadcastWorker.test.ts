import { QueuedIterator } from 'nats'

import { BroadcastConsumer } from '../../src/messaging/consumers/BroadcastConsumer'
import { NatsBroadcastWorker } from '../../src/messaging/consumers/NatsBroadcastWorker'

describe('NatsBroadcastWorker', () => {
  test('binds the durable TX_BROADCAST consumer and processes fetched messages', async () => {
    const messages = [makeMessage('one'), makeMessage('two')]
    const iterator = makeIterator(messages)
    const natsManager = {
      ensureConsumer: jest.fn(async () => undefined),
      pullMessages: jest.fn(async () => iterator),
      publishBroadcastDeadLetter: jest.fn(async () => undefined)
    }
    const consumer = {
      consumeJetStreamMessage: jest.fn(async () => []),
      close: jest.fn(async () => undefined)
    } as unknown as BroadcastConsumer
    const loader = { loadBroadcastRequest: jest.fn() }
    const recorder = { recordBroadcastAttempt: jest.fn() }
    const worker = new NatsBroadcastWorker({
      natsManager,
      consumer,
      loader,
      recorder,
      retryBackoffMs: 2500,
      maxDeliver: 3
    })

    await expect(worker.processBatch()).resolves.toEqual({ received: 2, processed: 2 })

    expect(natsManager.ensureConsumer).toHaveBeenCalledWith('TX_BROADCAST', 'broadcast-workers', undefined)
    expect(natsManager.pullMessages).toHaveBeenCalledWith('TX_BROADCAST', 'broadcast-workers', {
      batch: 100,
      expires: 30000
    })
    expect(consumer.consumeJetStreamMessage).toHaveBeenCalledTimes(2)
    expect(consumer.consumeJetStreamMessage).toHaveBeenNthCalledWith(
      1,
      messages[0],
      loader,
      recorder,
      expect.objectContaining({
        deadLetterPublisher: natsManager,
        maxDeliver: 3,
        retryBackoffMs: 2500
      })
    )
    expect(iterator.stop).toHaveBeenCalledTimes(1)
  })

  test('close drains the wrapped consumer and prevents new fetches', async () => {
    const natsManager = {
      ensureConsumer: jest.fn(async () => undefined),
      pullMessages: jest.fn(async () => makeIterator([])),
      publishBroadcastDeadLetter: jest.fn(async () => undefined)
    }
    const consumer = {
      consumeJetStreamMessage: jest.fn(async () => []),
      close: jest.fn(async () => undefined)
    } as unknown as BroadcastConsumer
    const worker = new NatsBroadcastWorker({
      natsManager,
      consumer,
      loader: { loadBroadcastRequest: jest.fn() },
      recorder: { recordBroadcastAttempt: jest.fn() }
    })

    await worker.close()
    await expect(worker.processBatch()).resolves.toEqual({ received: 0, processed: 0 })

    expect(consumer.close).toHaveBeenCalledTimes(1)
    expect(natsManager.pullMessages).not.toHaveBeenCalled()
  })
})

function makeMessage (id: string): any {
  return {
    id,
    json: jest.fn(),
    ack: jest.fn(),
    nak: jest.fn(),
    term: jest.fn()
  }
}

function makeIterator<T> (items: T[]): QueuedIterator<T> {
  const iterator = {
    async *[Symbol.asyncIterator] () {
      for (const item of items) yield item
    },
    stop: jest.fn(),
    getProcessed: jest.fn(() => items.length),
    getPending: jest.fn(() => 0),
    getReceived: jest.fn(() => items.length)
  }
  return iterator as unknown as QueuedIterator<T>
}
