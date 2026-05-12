import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { PrivateKey, Validation } from '@bsv/sdk'
import type { WalletStorageProvider } from '../../src/sdk/WalletStorage.interfaces'
import { createRocksDbWallet } from '../../src/SetupRocksDb'
import { WalletStorageManager } from '../../src/storage/WalletStorageManager'
import { RocksDbWalletStore } from '../../src/storage/rocksdb'

describe('RocksDbWalletStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-toolbox-rocksdb-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('persists versioned records and prefix scans through RocksDB', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      expect(await store.put({ key: 'utxo!a', value: { satoshis: 1 }, updated_at: 0 })).toMatchObject({
        ok: true,
        key: 'utxo!a',
        version: 1
      })
      expect(await store.put({ key: 'utxo!a', value: { satoshis: 2 }, expectedVersion: 1, updated_at: 1 })).toMatchObject({
        ok: true,
        key: 'utxo!a',
        version: 2
      })
      expect(await store.put({ key: 'utxo!a', value: { satoshis: 3 }, expectedVersion: 1 })).toMatchObject({
        ok: false,
        reason: 'version_conflict',
        currentVersion: 2
      })
      await store.put({ key: 'utxo!b', value: { satoshis: 4 } })

      const record = await store.get<{ satoshis: number }>('utxo!a')
      expect(record?.value.satoshis).toBe(2)
      expect(record?.version).toBe(2)

      const scanned = await store.scan<{ satoshis: number }>({ prefix: 'utxo!', limit: 10 })
      expect(scanned.map(r => r.key)).toEqual(['utxo!a', 'utxo!b'])
    } finally {
      store.close()
    }
  })

  test('applies batch writes and deletes transactionally', async () => {
    const store = await RocksDbWalletStore.open({ path: path.join(dir, 'wallet.rocksdb') })
    try {
      const results = await store.batch([
        { key: 'idem!1', value: { status: 'reserved' } },
        { key: 'idem!2', value: { status: 'reserved' } }
      ])
      expect(results.every(r => r.ok)).toBe(true)
      await store.batch([{ type: 'delete', key: 'idem!1' }])
      expect(await store.get('idem!1')).toBeUndefined()
      expect((await store.get<{ status: string }>('idem!2'))?.value.status).toBe('reserved')
    } finally {
      store.close()
    }
  })

  test('implements WalletStorageProvider availability and user bootstrap contract', async () => {
    const store = await RocksDbWalletStore.open({
      path: path.join(dir, 'wallet.rocksdb'),
      chain: 'test',
      storageName: 'rocksdb-test',
      storageIdentityKey: 'rocksdb-test-storage'
    })
    const provider: WalletStorageProvider = store
    const manager = new WalletStorageManager('identity-key', provider)
    try {
      const settings = await manager.makeAvailable()
      expect(settings.storageIdentityKey).toBe('rocksdb-test-storage')
      expect(settings.storageName).toBe('rocksdb-test')
      expect(settings.dbtype).toBe('RocksDB')
      expect(manager.getActiveStore()).toBe('rocksdb-test-storage')

      const { user, isNew } = await provider.findOrInsertUser('identity-key')
      expect(isNew).toBe(false)
      expect(user.activeStorage).toBe('rocksdb-test-storage')
      expect(await provider.findOutputBasketsAuth({ identityKey: 'identity-key', userId: user.userId }, { partial: { name: 'default' } })).toHaveLength(1)
      expect(provider.isStorageProvider()).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(RocksDbWalletStore.prototype, 'createAction')).toBe(false)

      await expect(provider.listActions({ identityKey: 'identity-key', userId: user.userId }, Validation.validateListActionsArgs({ labels: [] }))).resolves.toEqual({
        totalActions: 0,
        actions: []
      })
      await expect(provider.listOutputs({ identityKey: 'identity-key', userId: user.userId }, Validation.validateListOutputsArgs({ basket: 'default' }))).resolves.toEqual({
        totalOutputs: 0,
        outputs: []
      })
    } finally {
      store.close()
    }
  })

  test('can be configured for mainnet without disabling provider behavior', async () => {
    const store = await RocksDbWalletStore.open({
      path: path.join(dir, 'main-wallet.rocksdb'),
      chain: 'main',
      storageName: 'rocksdb-main',
      storageIdentityKey: 'rocksdb-main-storage'
    })
    try {
      const settings = await store.makeAvailable()
      expect(settings.chain).toBe('main')
      expect(settings.dbtype).toBe('RocksDB')
      expect(store.isStorageProvider()).toBe(true)
    } finally {
      store.close()
    }
  })

  test('createRocksDbWallet follows native wallet setup with RocksDB storage', async () => {
    const rootKey = PrivateKey.fromRandom()
    const setup = await createRocksDbWallet({
      chain: 'test',
      rootKeyHex: rootKey.toHex(),
      path: path.join(dir, 'setup-wallet.rocksdb'),
      namespace: 'autonomous-commerce'
    })
    try {
      expect(setup.chain).toBe('test')
      expect(setup.identityKey).toBe(rootKey.toPublicKey().toString())
      expect(setup.storage.getActiveStore()).toMatch(/^rocksdb:test:autonomous-commerce$/)
      expect(setup.activeStorage.isStorageProvider()).toBe(true)
      expect((await setup.activeStorage.makeAvailable()).dbtype).toBe('RocksDB')
    } finally {
      setup.activeStorage.close()
    }
  })
})
