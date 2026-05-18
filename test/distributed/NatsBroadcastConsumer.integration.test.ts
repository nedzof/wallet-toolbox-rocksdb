import { Beef, PrivateKey, Script, Transaction } from '@bsv/sdk'
import { existsSync, readFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  connect,
  DeliverPolicy,
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  nanos,
  NatsConnection
} from 'nats'

import { BroadcastConsumer } from '../../src/messaging/consumers/BroadcastConsumer'
import { NatsBroadcastWorker } from '../../src/messaging/consumers/NatsBroadcastWorker'
import { NatsManager } from '../../src/messaging/NatsManager'
import { BroadcastPublisher } from '../../src/messaging/publishers/BroadcastPublisher'
import { TxBroadcastMessage } from '../../src/messaging/messages'
import { PostBeefResult } from '../../src/sdk/WalletServices.interfaces'
import { BroadcastStorageAdapter } from '../../src/storage/BroadcastStorageAdapter'
import { StorageProvider } from '../../src/storage/StorageProvider'
import { StorageRocksDb } from '../../src/storage/StorageRocksDb'
import { TableProvenTxReq } from '../../src/storage/schema/tables/TableProvenTxReq'
import { TableTransaction } from '../../src/storage/schema/tables/TableTransaction'
import { doubleSha256BE } from '../../src/utility/utilityHelpers'
import { asString } from '../../src/utility/utilityHelpers.noBuffer'

describe('NATS broadcast consumer integration contract', () => {
  test('publisher emits stable duplicate keys and consumer records one durable outcome per message', async () => {
    const published: TxBroadcastMessage[] = []
    const publisher = new BroadcastPublisher({
      natsManager: {
        publishTxBroadcast: jest.fn(async message => {
          published.push(message)
          return {
            stream: 'TX_BROADCAST',
            seq: published.length,
            duplicate: published.some(existing => existing !== message && existing.idempotencyKey === message.idempotencyKey)
          }
        })
      },
      chain: 'test',
      walletStorageIdentityKey: 'storage-key'
    })
    const reference = {
      txid: 'a'.repeat(64),
      provenTxReqId: 10,
      rawTxHash: 'a'.repeat(64),
      attempt: 1
    }

    const firstAck = await publisher.publish(reference)
    const secondAck = await publisher.publish(reference)

    expect(firstAck.duplicate).toBe(false)
    expect(secondAck.duplicate).toBe(true)
    expect(published[0].idempotencyKey).toBe(published[1].idempotencyKey)

    const results: PostBeefResult[] = [{
      name: 'provider',
      status: 'success',
      txidResults: [{ txid: reference.txid, status: 'success' }]
    }]
    const consumer = BroadcastConsumer.fromServices({
      postBeef: jest.fn(async () => results)
    })
    const recorder = { recordBroadcastAttempt: jest.fn(async () => undefined) }
    const ackable = makeAckable(published[0])

    await consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => ({ beef: new Beef(), txid: reference.txid })) },
      recorder
    )

    expect(recorder.recordBroadcastAttempt).toHaveBeenCalledTimes(1)
    expect(ackable.ack).toHaveBeenCalledTimes(1)
    expect(ackable.nak).not.toHaveBeenCalled()
    await consumer.close()
  })

  test('malformed distributed broadcast messages are termed', async () => {
    const consumer = BroadcastConsumer.fromServices({ postBeef: jest.fn(async () => [] as PostBeefResult[]) })
    const ackable = {
      string: jest.fn(() => '{not json'),
      ack: jest.fn(),
      nak: jest.fn(),
      term: jest.fn()
    }

    await consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => ({ beef: new Beef(), txid: 'a'.repeat(64) })) },
      { recordBroadcastAttempt: jest.fn(async () => undefined) }
    )

    expect(ackable.term).toHaveBeenCalled()
    expect(ackable.ack).not.toHaveBeenCalled()
    expect(ackable.nak).not.toHaveBeenCalled()
    await consumer.close()
  })

  test('unknown provider outcome is recorded and ACKed without blind retry', async () => {
    const consumer = BroadcastConsumer.fromServices({ postBeef: jest.fn(async () => [] as PostBeefResult[]) })
    const recorder = { recordBroadcastAttempt: jest.fn(async () => undefined) }
    const ackable = makeAckable(makeMessage())

    await consumer.consumeJetStreamMessage(
      ackable,
      { loadBroadcastRequest: jest.fn(async () => ({ beef: new Beef(), txid: 'a'.repeat(64) })) },
      recorder
    )

    expect(recorder.recordBroadcastAttempt).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'unknown' }))
    expect(ackable.ack).toHaveBeenCalledTimes(1)
    expect(ackable.nak).not.toHaveBeenCalled()
    await consumer.close()
  })
})

const liveDescribe: typeof describe = isLiveAcceptanceReady() ? describe : describe.skip

liveDescribe('NATS broadcast consumer live distributed acceptance', () => {
  jest.setTimeout(120000)

  let connection: NatsConnection
  let jetstream: JetStreamClient
  let jetstreamManager: JetStreamManager
  let natsManager: NatsManager
  let runId: string
  let subject: string
  let durable: string
  let deadLetterDurable: string
  let dir: string
  let storage: StorageRocksDb
  let adapter: BroadcastStorageAdapter

  beforeAll(async () => {
    connection = await connect({
      servers: process.env.NATS_URL,
      name: 'wallet-toolbox-rocksdb-distributed-acceptance',
      user: process.env.NATS_USER || undefined,
      pass: process.env.NATS_PASSWORD || undefined,
      token: process.env.NATS_TOKEN || undefined
    })
    jetstream = connection.jetstream()
    jetstreamManager = await connection.jetstreamManager()
    natsManager = new NatsManager({ connection, jetstream, jetstreamManager })
    await natsManager.initializeStreams()
  })

  beforeEach(async () => {
    runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    subject = `tx.broadcast.acceptance.${runId}`
    durable = `broadcast-workers-${runId}`
    deadLetterDurable = `dead-letter-${runId}`
    await natsManager.ensureConsumer('TX_BROADCAST', durable, {
      filter_subject: subject,
      deliver_policy: DeliverPolicy.New,
      ack_wait: nanos(1000),
      max_deliver: 3,
      max_ack_pending: 500
    })
    await natsManager.ensureConsumer('DEAD_LETTER', deadLetterDurable, {
      filter_subject: 'deadletter.tx.broadcast.test',
      deliver_policy: DeliverPolicy.New,
      ack_wait: nanos(1000),
      max_deliver: 1
    })
    dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-live-distributed-'))
    storage = new StorageRocksDb({
      ...StorageProvider.createStorageBaseOptions('test'),
      path: path.join(dir, 'distributed.rocksdb')
    })
    await storage.migrate('distributed-acceptance', PrivateKey.fromRandom().toPublicKey().toString())
    await storage.makeAvailable()
    adapter = new BroadcastStorageAdapter(storage)
  })

  afterEach(async () => {
    await jetstreamManager.consumers.delete('TX_BROADCAST', durable).catch(() => false)
    await jetstreamManager.consumers.delete('DEAD_LETTER', deadLetterDurable).catch(() => false)
    await storage.destroy()
    await rm(dir, { recursive: true, force: true })
  })

  afterAll(async () => {
    await connection.drain()
  })

  test('11.1 exactly-once processing across two durable workers', async () => {
    const seeded = await seedReqs(100)
    const consumer = BroadcastConsumer.fromServices(makeServices('success'))
    await Promise.all(seeded.map(async item => await natsManager.publishJson(subject, item.message)))

    const workerByKey = new Map<string, string>()
    const [a, b] = await Promise.all([
      processWorker('worker-a', 50, consumer, workerByKey),
      processWorker('worker-b', 50, consumer, workerByKey)
    ])

    expect(a + b).toBe(100)
    expect(workerByKey.size).toBe(100)
    for (const item of seeded) {
      const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: item.reqId } })
      expect(req.status).toBe('unmined')
      expect(historyCount(req, item.message.idempotencyKey)).toBe(1)
    }
    await consumer.close()
  })

  test('11.2 duplicate message deduplication prevents duplicate external effects', async () => {
    const [seeded] = await seedReqs(1)
    const services = makeServices('success')
    const consumer = BroadcastConsumer.fromServices(services)
    const first = await natsManager.publishJson(subject, seeded.message)
    const second = await natsManager.publishJson(subject, seeded.message)

    const messages = await fetchMessages(2, 2000)
    for (const message of messages) {
      await consumer.consumeJetStreamMessage(message, adapter, adapter, { deadLetterPublisher: natsManager })
    }

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(messages).toHaveLength(1)
    expect(services.postBeef).toHaveBeenCalledTimes(1)
    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: seeded.reqId } })
    expect(historyCount(req, seeded.message.idempotencyKey)).toBe(1)
    await consumer.close()
  })

  test('11.3 unacked restart redelivers to another worker and records one outcome', async () => {
    const [seeded] = await seedReqs(1)
    const services = makeServices('success')
    const consumer = BroadcastConsumer.fromServices(services)
    await natsManager.publishJson(subject, seeded.message)

    const [firstDelivery] = await fetchMessages(1, 2000)
    expect(firstDelivery).toBeDefined()
    await sleep(1300)
    const [redelivery] = await fetchMessages(1, 3000)
    expect(redelivery.info.deliveryCount).toBeGreaterThanOrEqual(2)

    await consumer.consumeJetStreamMessage(redelivery, adapter, adapter, { deadLetterPublisher: natsManager })

    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: seeded.reqId } })
    expect(historyCount(req, seeded.message.idempotencyKey)).toBe(1)
    expect(req.txid).toBe(seeded.message.txid)
    expect(services.postBeef).toHaveBeenCalledTimes(1)
    await consumer.close()
  })

  test('11.4 max deliver exceeded routes to dead letter without completed broadcast', async () => {
    const [seeded] = await seedReqs(1)
    const consumer = BroadcastConsumer.fromServices(makeServices('success'))
    await natsManager.publishJson(subject, seeded.message)

    for (let i = 0; i < 3; i++) {
      const [message] = await fetchMessages(1, 3000)
      await consumer.consumeJetStreamMessage(
        message,
        { loadBroadcastRequest: async () => { throw new Error('rocksdb write failed') } },
        { recordBroadcastAttempt: async () => undefined },
        { deadLetterPublisher: natsManager, maxDeliver: 3, retryBackoffMs: 1 }
      )
      await sleep(50)
    }

    const [deadLetter] = await fetchDeadLetters(1, 3000)
    expect(deadLetter.json()).toEqual(expect.objectContaining({
      originalStream: 'TX_BROADCAST',
      originalTxid: seeded.message.txid,
      deliveryCount: 3
    }))
    deadLetter.ack()
    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: seeded.reqId } })
    expect(req.status).toBe('sending')
    await consumer.close()
  })

  test('11.5 malformed messages are termed and dead-lettered without storage mutation', async () => {
    const consumer = BroadcastConsumer.fromServices(makeServices('success'))
    const badMessage = {
      messageId: 'malformed',
      idempotencyKey: `${runId}:malformed`,
      createdAtMs: Date.now(),
      schemaVersion: 1,
      source: 'test',
      chain: 'test',
      rawTxHash: 'a'.repeat(64),
      walletStorageIdentityKey: 'storage',
      provenTxReqId: 1,
      attempt: 1,
      priority: 1
    }
    await natsManager.publishJson(subject, badMessage)
    const [message] = await fetchMessages(1, 2000)

    await consumer.consumeJetStreamMessage(
      message,
      adapter,
      adapter,
      { deadLetterPublisher: natsManager, deadLetterChain: 'test' }
    )

    const [deadLetter] = await fetchDeadLetters(1, 3000)
    expect(deadLetter.json()).toEqual(expect.objectContaining({
      originalStream: 'TX_BROADCAST',
      reason: expect.stringContaining('txid')
    }))
    deadLetter.ack()
    expect(await storage.findProvenTxReqs({ partial: {} })).toHaveLength(0)
    await consumer.close()
  })

  test('11.6 unknown provider outcome is recorded and ACKed without blind retry', async () => {
    const [seeded] = await seedReqs(1)
    const consumer = BroadcastConsumer.fromServices(makeServices('unknown'))
    await natsManager.publishJson(subject, seeded.message)
    const [message] = await fetchMessages(1, 2000)

    await consumer.consumeJetStreamMessage(message, adapter, adapter, { deadLetterPublisher: natsManager })

    const [req] = await storage.findProvenTxReqs({ partial: { provenTxReqId: seeded.reqId } })
    expect(req.status).toBe('unknown')
    expect(historyCount(req, seeded.message.idempotencyKey)).toBe(1)
    expect(await fetchMessages(1, 1000)).toHaveLength(0)
    await consumer.close()
  })

  async function processWorker (
    worker: string,
    maxMessages: number,
    consumer: BroadcastConsumer,
    workerByKey: Map<string, string>
  ): Promise<number> {
    const recorder = {
      recordBroadcastAttempt: async (record: Parameters<BroadcastStorageAdapter['recordBroadcastAttempt']>[0]) => {
        workerByKey.set(record.message.idempotencyKey, worker)
        await adapter.recordBroadcastAttempt(record)
      }
    }
    const pullWorker = new NatsBroadcastWorker({
      natsManager,
      consumer,
      loader: adapter,
      recorder,
      durableName: durable,
      batchSize: maxMessages,
      expiresMs: 5000
    })
    const result = await pullWorker.processBatch()
    return result.processed
  }

  async function fetchMessages (maxMessages: number, expires: number): Promise<JsMsg[]> {
    const iterator = jetstream.fetch('TX_BROADCAST', durable, { batch: maxMessages, expires })
    const messages: JsMsg[] = []
    for await (const message of iterator) {
      messages.push(message)
      if (messages.length >= maxMessages) {
        iterator.stop()
        break
      }
    }
    return messages
  }

  async function fetchDeadLetters (maxMessages: number, expires: number): Promise<JsMsg[]> {
    const iterator = jetstream.fetch('DEAD_LETTER', deadLetterDurable, { batch: maxMessages, expires })
    const messages: JsMsg[] = []
    for await (const message of iterator) {
      messages.push(message)
      if (messages.length >= maxMessages) {
        iterator.stop()
        break
      }
    }
    return messages
  }

  async function seedReqs (count: number): Promise<Array<{ reqId: number, message: TxBroadcastMessage }>> {
    const seeded: Array<{ reqId: number, message: TxBroadcastMessage }> = []
    for (let i = 0; i < count; i++) {
      const tx = new Transaction()
      tx.addOutput({ lockingScript: Script.fromASM('OP_1'), satoshis: 1 })
      const rawTx = tx.toBinary()
      const txid = tx.id('hex')
      const transactionId = await storage.insertTransaction(makeTransaction('sending', txid, i))
      const reqId = await storage.insertProvenTxReq(makeReq(txid, rawTx, transactionId))
      seeded.push({ reqId, message: makeLiveMessage(reqId, txid, rawTx) })
    }
    return seeded
  }

  function makeLiveMessage (provenTxReqId: number, txid: string, rawTx: number[]): TxBroadcastMessage {
    return {
      messageId: `${runId}-${provenTxReqId}`,
      idempotencyKey: `test:storage:broadcast:${provenTxReqId}:${txid}:1`,
      createdAtMs: Date.now(),
      schemaVersion: 1,
      source: 'distributed-acceptance',
      chain: 'test',
      txid,
      rawTxHash: asString(doubleSha256BE(rawTx)),
      attempt: 1,
      priority: 1,
      walletStorageIdentityKey: 'storage',
      provenTxReqId
    }
  }
})

function makeMessage (): TxBroadcastMessage {
  return {
    messageId: 'msg',
    idempotencyKey: `test:storage-key:broadcast:10:${'a'.repeat(64)}:1`,
    createdAtMs: Date.now(),
    schemaVersion: 1,
    source: 'test',
    chain: 'test',
    txid: 'a'.repeat(64),
    rawTxHash: 'a'.repeat(64),
    attempt: 1,
    priority: 1,
    walletStorageIdentityKey: 'storage-key',
    provenTxReqId: 10
  }
}

function makeAckable (message: TxBroadcastMessage): any {
  return {
    json: jest.fn(() => message),
    ack: jest.fn(),
    nak: jest.fn(),
    term: jest.fn()
  }
}

function makeServices (mode: 'success' | 'unknown'): { postBeef: jest.Mock<Promise<PostBeefResult[]>, [Beef, string[]]> } {
  return {
    postBeef: jest.fn(async (_beef: Beef, txids: string[]) => {
      if (mode === 'unknown') return []
      const results: PostBeefResult[] = [{
        name: 'provider',
        status: 'success',
        txidResults: txids.map(txid => ({ txid, status: 'success' as const }))
      }]
      return results
    })
  }
}

function makeReq (txid: string, rawTx: number[], transactionId: number): TableProvenTxReq {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    provenTxReqId: 0,
    status: 'sending',
    attempts: 1,
    notified: false,
    txid,
    history: '{}',
    notify: JSON.stringify({ transactionIds: [transactionId] }),
    rawTx,
    inputBEEF: new Beef().toBinary(),
    wasBroadcast: false,
    rebroadcastAttempts: 0
  }
}

function makeTransaction (status: TableTransaction['status'], txid: string, index: number): TableTransaction {
  const now = new Date()
  return {
    created_at: now,
    updated_at: now,
    transactionId: 0,
    userId: 1,
    status,
    reference: `distributed-acceptance-${index}`,
    isOutgoing: true,
    satoshis: 1,
    version: 1,
    lockTime: 0,
    txid,
    description: 'distributed acceptance test'
  }
}

function historyCount (req: TableProvenTxReq, idempotencyKey: string): number {
  const history = JSON.parse(req.history) as { notes?: Array<{ distributedBroadcastIdempotencyKey?: string }> }
  return history.notes?.filter(note => note.distributedBroadcastIdempotencyKey === idempotencyKey).length ?? 0
}

function isLiveAcceptanceReady (): boolean {
  if (process.env.NATS_URL == null || process.env.NATS_URL.trim() === '') return false
  const artifact = path.join(process.cwd(), '.tmp', 'wallet-toolbox-throughput-safety', 'latest.json')
  if (!existsSync(artifact)) return false
  try {
    const latest = JSON.parse(readFileSync(artifact, 'utf8')) as { ok?: boolean, highestCleanStage?: string }
    return latest.ok === true && latest.highestCleanStage === '50tps-10s'
  } catch {
    return false
  }
}

async function sleep (ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
