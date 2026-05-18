import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { CachedKeyDeriver, P2PKH, PrivateKey, Script, Transaction, Utils } from '@bsv/sdk'
import { Services } from '../../src/services/Services'
import { StorageProvider } from '../../src/storage/StorageProvider'
import { StorageRocksDb } from '../../src/storage/StorageRocksDb'
import { WalletStorageManager } from '../../src/storage/WalletStorageManager'
import { TableOutput } from '../../src/storage/schema/tables/TableOutput'
import { TableTransaction } from '../../src/storage/schema/tables/TableTransaction'
import { ScriptTemplateBRC29 } from '../../src/utility/ScriptTemplateBRC29'
import { Wallet } from '../../src/Wallet'

describe('StorageRocksDb', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-storage-rocksdb-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('is a WalletStorageProvider usable by WalletStorageManager', async () => {
    const identityKey = PrivateKey.fromRandom().toPublicKey().toString()
    const storage = await createStorage('manager', '11'.repeat(32))
    const manager = new WalletStorageManager(identityKey, storage)

    try {
      const settings = await manager.makeAvailable()
      const auth = await manager.getAuth()
      const baskets = await manager.findOutputBaskets({ partial: { name: 'default' } })

      expect(storage.isStorageProvider()).toBe(true)
      expect(settings.dbtype).toBe('RocksDB')
      expect(auth.userId).toBe(1)
      expect(auth.isActive).toBe(true)
      expect(baskets).toHaveLength(1)
      expect(baskets[0]).toMatchObject({ userId: auth.userId, name: 'default' })
    } finally {
      await manager.destroy()
    }
  })

  test('persists wallet entities and allocates change through StorageProvider methods', async () => {
    const storage = await createStorage('crud', '22'.repeat(32))
    try {
      const { user } = await storage.findOrInsertUser(PrivateKey.fromRandom().toPublicKey().toString())
      const [basket] = await storage.findOutputBaskets({ partial: { userId: user.userId, name: 'default' } })
      const transactionId = await storage.insertTransaction(makeTransaction(user.userId, 'a'.repeat(64), 250))
      const outputId = await storage.insertOutput(makeOutput(user.userId, basket.basketId, transactionId, 'a'.repeat(64), 250))

      expect(await storage.countChangeInputs(user.userId, basket.basketId, true)).toBe(1)
      const allocated = await storage.allocateChangeInput(user.userId, basket.basketId, 100, undefined, true, transactionId + 1)
      const output = (await storage.findOutputs({ partial: { outputId } }))[0]

      expect(allocated?.outputId).toBe(outputId)
      expect(output.spendable).toBe(false)
      expect(output.spentBy).toBe(transactionId + 1)
      expect(await storage.countChangeInputs(user.userId, basket.basketId, true)).toBe(0)
    } finally {
      await storage.destroy()
    }
  })

  test('allocates transaction ids without duplicates under concurrent inserts', async () => {
    const storage = await createStorage('concurrent-ids', '55'.repeat(32))
    try {
      const { user } = await storage.findOrInsertUser(PrivateKey.fromRandom().toPublicKey().toString())
      const ids = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
        return await storage.insertTransaction(makeTransaction(user.userId, txidFor(index + 1), 1))
      }))

      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
    } finally {
      await storage.destroy()
    }
  })

  test('reserves distinct change outputs under concurrent allocation', async () => {
    const storage = await createStorage('concurrent-change', '66'.repeat(32))
    try {
      const { user } = await storage.findOrInsertUser(PrivateKey.fromRandom().toPublicKey().toString())
      const [basket] = await storage.findOutputBaskets({ partial: { userId: user.userId, name: 'default' } })
      const sourceTransactionId = await storage.insertTransaction(makeTransaction(user.userId, txidFor(100), 500))
      const sourceOutputIds = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        return await storage.insertOutput({
          ...makeOutput(user.userId, basket.basketId, sourceTransactionId, txidFor(100), 50),
          vout: index
        })
      }))

      const allocated = await Promise.all(sourceOutputIds.map(async (_, index) => {
        return await storage.allocateChangeInput(user.userId, basket.basketId, 1, undefined, true, 1000 + index)
      }))

      const allocatedOutputs = allocated.filter((output): output is TableOutput => output != null)
      const allocatedIds = allocatedOutputs.map(output => output.outputId)
      const storedOutputs = await storage.findOutputs({ partial: { userId: user.userId, basketId: basket.basketId }, noScript: true })

      expect(allocatedOutputs).toHaveLength(sourceOutputIds.length)
      expect(new Set(allocatedIds).size).toBe(sourceOutputIds.length)
      expect(await storage.countChangeInputs(user.userId, basket.basketId, true)).toBe(0)
      expect(storedOutputs.every(output => output.spendable === false)).toBe(true)
      expect(new Set(storedOutputs.map(output => output.spentBy)).size).toBe(sourceOutputIds.length)
    } finally {
      await storage.destroy()
    }
  })

  test('backs a Wallet.createAction flow', async () => {
    const rootKey = PrivateKey.fromRandom()
    const keyDeriver = new CachedKeyDeriver(rootKey)
    const storage = await createStorage('wallet', '33'.repeat(32))
    const manager = new WalletStorageManager(keyDeriver.identityKey, storage)
    const services = new Services('test')
    const wallet = new Wallet({ chain: 'test', keyDeriver, storage: manager, services })

    try {
      await manager.makeAvailable()
      const auth = await manager.getAuth()
      const [basket] = await storage.findOutputBaskets({ partial: { userId: auth.userId, name: 'default' } })
      const sourceDerivationPrefix = Utils.toBase64([1, 2, 3, 4, 5, 6, 7, 8])
      const sourceDerivationSuffix = Utils.toBase64([9, 10, 11, 12, 13, 14, 15, 16])
      const sourceLockingScript = new ScriptTemplateBRC29({
        derivationPrefix: sourceDerivationPrefix,
        derivationSuffix: sourceDerivationSuffix,
        keyDeriver
      }).lock(rootKey.toString(), rootKey.toPublicKey().toString()).toHex()
      const sourceTx = new Transaction()
      sourceTx.addOutput({ lockingScript: Script.fromHex(sourceLockingScript), satoshis: 1000 })
      const sourceTxid = sourceTx.id('hex')
      const transactionId = await storage.insertTransaction(makeTransaction(auth.userId!, sourceTxid, 1000))
      const now = new Date()
      await storage.insertProvenTxReq({
        created_at: now,
        updated_at: now,
        provenTxReqId: 0,
        status: 'completed',
        attempts: 0,
        notified: false,
        txid: sourceTxid,
        history: '{}',
        notify: '{}',
        rawTx: sourceTx.toBinary()
      })
      await storage.insertOutput({
        ...makeOutput(auth.userId!, basket.basketId, transactionId, sourceTxid, 1000),
        lockingScript: Utils.toArray(sourceLockingScript, 'hex'),
        providedBy: 'storage',
        derivationPrefix: sourceDerivationPrefix,
        derivationSuffix: sourceDerivationSuffix
      })

      const result = await wallet.createAction({
        description: 'storage rocksdb wallet create action',
        outputs: [{
          lockingScript: new P2PKH().lock(rootKey.toPublicKey().toAddress()).toHex(),
          satoshis: 1,
          outputDescription: 'storage rocksdb wallet output'
        }],
        options: {
          randomizeOutputs: false,
          noSend: true
        }
      })

      expect(result.signableTransaction ?? result.txid).toBeTruthy()
    } finally {
      await wallet.destroy()
    }
  })

  test('records transaction tail wait and run timings when metrics are configured', async () => {
    const recordStorageQuery = jest.fn()
    const setTransactionTailQueueDepth = jest.fn()
    const storage = new StorageRocksDb({
      ...StorageProvider.createStorageBaseOptions('test'),
      path: path.join(dir, 'metrics.rocksdb'),
      rocksDb: {
        metrics: { recordStorageQuery, setTransactionTailQueueDepth }
      }
    })

    try {
      await storage.migrate('metrics', '44'.repeat(32))
      await storage.makeAvailable()
      await expect(storage.transaction(async () => 'ok')).resolves.toBe('ok')

      expect(recordStorageQuery).toHaveBeenCalledWith('transactionTail.wait', expect.any(Number))
      expect(recordStorageQuery).toHaveBeenCalledWith('transactionTail.run', expect.any(Number))
      expect(setTransactionTailQueueDepth).toHaveBeenCalledWith(1)
      expect(setTransactionTailQueueDepth).toHaveBeenCalledWith(0)
    } finally {
      await storage.destroy()
    }
  })

  async function createStorage (name: string, storageIdentityKey: string): Promise<StorageRocksDb> {
    const storage = new StorageRocksDb({
      ...StorageProvider.createStorageBaseOptions('test'),
      path: path.join(dir, `${name}.rocksdb`)
    })
    await storage.migrate(name, storageIdentityKey)
    await storage.makeAvailable()
    return storage
  }

  function makeTransaction (userId: number, txid: string, satoshis: number): TableTransaction {
    const now = new Date()
    return {
      created_at: now,
      updated_at: now,
      transactionId: 0,
      userId,
      status: 'unproven',
      reference: 'rocksdb-storage-provider-test',
      isOutgoing: false,
      satoshis,
      description: 'storage rocksdb test transaction',
      version: 1,
      lockTime: 0,
      txid
    }
  }

  function makeOutput (userId: number, basketId: number, transactionId: number, txid: string, satoshis: number): TableOutput {
    const now = new Date()
    return {
      created_at: now,
      updated_at: now,
      outputId: 0,
      userId,
      transactionId,
      basketId,
      spendable: true,
      change: true,
      outputDescription: 'storage rocksdb test output',
      vout: 0,
      satoshis,
      providedBy: 'you',
      purpose: 'change',
      type: 'P2PKH',
      txid,
      lockingScript: [0x51]
    }
  }

  function txidFor (value: number): string {
    return value.toString(16).padStart(64, '0')
  }
})
