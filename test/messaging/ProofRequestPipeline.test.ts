import { BlockEventConsumer } from '../../src/messaging/consumers/BlockEventConsumer'
import { ProofRequestConsumer } from '../../src/messaging/consumers/ProofRequestConsumer'
import { ProofRequestPublisher } from '../../src/messaging/publishers/ProofRequestPublisher'
import { BlockEventMessage, ProofRequestMessage } from '../../src/messaging/messages'

describe('distributed proof request pipeline', () => {
  test('ProofRequestPublisher creates durable proof request messages', async () => {
    const publishProofRequest = jest.fn(async () => ({ stream: 'PROOF_REQUESTS', seq: 1, duplicate: false }))
    const publisher = new ProofRequestPublisher({
      natsManager: { publishProofRequest, publishProofResult: jest.fn() },
      chain: 'test',
      walletStorageIdentityKey: 'storage-key'
    })

    await publisher.publishRequest({
      provenTxReqId: 17,
      txid: 'a'.repeat(64),
      requestedAt: '2026-05-18T00:00:00.000Z'
    })

    expect(publishProofRequest).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'test',
      provenTxReqId: 17,
      txid: 'a'.repeat(64),
      walletStorageIdentityKey: 'storage-key',
      requestedAt: '2026-05-18T00:00:00.000Z',
      idempotencyKey: `test:storage-key:proof-request:17:${'a'.repeat(64)}`
    }))
  })

  test('ProofRequestConsumer records provider result before ACK', async () => {
    const order: string[] = []
    const consumer = new ProofRequestConsumer(
      {
        processProofRequest: jest.fn(async () => ({
          provenTxReqId: 0,
          txid: '',
          status: 'completed' as const,
          blockHeight: 100,
          merklePath: 'proof',
          providerAttempts: ['provider:success'],
          observedAt: '2026-05-18T00:00:00.000Z'
        }))
      },
      {
        recordProofResult: jest.fn(async (_request, result) => {
          expect(result.status).toBe('completed')
          order.push('record')
        })
      },
      {
        publishResult: jest.fn(async () => {
          order.push('publish')
        })
      }
    )

    const ackable = makeAckable(makeProofRequest(), order)
    await consumer.processJetStreamMessage(ackable)

    expect(order).toEqual(['record', 'publish', 'ack'])
    expect(ackable.nak).not.toHaveBeenCalled()
    expect(ackable.term).not.toHaveBeenCalled()
  })

  test('BlockEventConsumer wakes pending proof requests on mined blocks', async () => {
    const publishRequest = jest.fn(async () => ({ stream: 'PROOF_REQUESTS', seq: 1, duplicate: false }))
    const consumer = new BlockEventConsumer(
      {
        findPendingProofRequests: jest.fn(async () => [
          { provenTxReqId: 1, txid: 'a'.repeat(64), walletStorageIdentityKey: 'storage-key' },
          { provenTxReqId: 2, txid: 'b'.repeat(64), walletStorageIdentityKey: 'storage-key' }
        ])
      },
      { publishRequest }
    )
    const block = makeBlockEvent({ type: 'mined', blockHeight: 10 })

    await expect(consumer.consume(block)).resolves.toBe(2)

    expect(publishRequest).toHaveBeenCalledTimes(2)
    expect(publishRequest).toHaveBeenCalledWith(expect.objectContaining({ provenTxReqId: 1 }))
    expect(publishRequest).toHaveBeenCalledWith(expect.objectContaining({ provenTxReqId: 2 }))
  })
})

function makeProofRequest (): ProofRequestMessage {
  return {
    messageId: 'msg',
    idempotencyKey: 'key',
    createdAtMs: Date.now(),
    schemaVersion: 1,
    source: 'test',
    chain: 'test',
    provenTxReqId: 17,
    txid: 'a'.repeat(64),
    walletStorageIdentityKey: 'storage-key',
    requestedAt: '2026-05-18T00:00:00.000Z'
  }
}

function makeBlockEvent (overrides: Partial<BlockEventMessage>): BlockEventMessage {
  return {
    messageId: 'msg',
    idempotencyKey: 'key',
    createdAtMs: Date.now(),
    schemaVersion: 1,
    source: 'test',
    chain: 'test',
    type: 'mined',
    blockHeight: 1,
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
