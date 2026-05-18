import { BroadcastPublisher, createTxBroadcastIdempotencyKey } from '../../src/messaging/publishers/BroadcastPublisher'

describe('BroadcastPublisher', () => {
  test('generates the required idempotency key', () => {
    expect(createTxBroadcastIdempotencyKey({
      chain: 'test',
      walletStorageIdentityKey: 'storage-key',
      provenTxReqId: 42,
      txid: 'a'.repeat(64),
      attempt: 3
    })).toBe(`test:storage-key:broadcast:42:${'a'.repeat(64)}:3`)
  })

  test('publishes a TxBroadcastMessage without raw transaction bytes', async () => {
    const publishTxBroadcast = jest.fn(async () => ({ stream: 'TX_BROADCAST', seq: 7, duplicate: false }))
    const publisher = new BroadcastPublisher({
      natsManager: { publishTxBroadcast },
      chain: 'test',
      walletStorageIdentityKey: 'storage-key'
    })

    await expect(publisher.publish({
      txid: 'b'.repeat(64),
      provenTxReqId: 9,
      rawTxHash: 'c'.repeat(64),
      attempt: 2,
      priority: 11
    })).resolves.toEqual({ stream: 'TX_BROADCAST', seq: 7, duplicate: false })

    expect(publishTxBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      chain: 'test',
      txid: 'b'.repeat(64),
      rawTxHash: 'c'.repeat(64),
      priority: 11,
      provenTxReqId: 9,
      walletStorageIdentityKey: 'storage-key'
    }))
    const message = (publishTxBroadcast as jest.Mock).mock.calls[0][0]
    expect(message.rawTx).toBeUndefined()
    expect(message.rawTxHex).toBeUndefined()
    expect(message.idempotencyKey).toBe(`test:storage-key:broadcast:9:${'b'.repeat(64)}:2`)
  })
})
