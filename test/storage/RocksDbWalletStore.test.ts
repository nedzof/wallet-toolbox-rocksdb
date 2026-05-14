import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { P2PKH, PrivateKey, Transaction, Validation } from '@bsv/sdk'
import type { WalletStorageProvider } from '../../src/sdk/WalletStorage.interfaces'
import {
  createRocksDbWallet,
  getRocksDbWalletReceiveDestinationFromSignerRef,
  initializeRocksDbWalletFromSignerRef,
  inspectRocksDbWalletFromSignerRef,
  openRocksDbWalletFromSignerRef
} from '../../src/SetupRocksDb'
import { dryRunRocksDbWalletPayment, importRocksDbWalletUtxos, listRocksDbWalletSpendableUtxosFromSignerRef, signRocksDbWalletPayment, syncRocksDbWalletUtxos } from '../../src/signer/ProductionSigning'
import * as rocksDbEntrypoint from '../../src/index.rocksdb'
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
      await expect(store.get('idem!missing')).resolves.toBeUndefined()
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
      namespace: 'demo-wallet'
    })
    try {
      expect(setup.chain).toBe('test')
      expect(setup.identityKey).toBe(rootKey.toPublicKey().toString())
      expect(setup.storage.getActiveStore()).toMatch(/^rocksdb:test:demo-wallet$/)
      expect(setup.activeStorage.isStorageProvider()).toBe(true)
      expect((await setup.activeStorage.makeAvailable()).dbtype).toBe('RocksDB')
    } finally {
      setup.activeStorage.close()
    }
  })

  test('initializeRocksDbWalletFromSignerRef is idempotent and returns redacted readiness', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const walletPath = path.join(dir, 'signer-ref-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    await expect(inspectRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-wallet-not-initialized'
    })

    const first = await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    const second = await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    const inspected = await inspectRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath
    })

    expect(first).toMatchObject({
      ok: true,
      walletInitialized: true,
      network: 'bsv-testnet',
      blocker: null
    })
    expect(second).toMatchObject(first)
    expect(inspected).toMatchObject({
      ok: true,
      walletInitialized: true,
      network: 'bsv-testnet',
      identityKeyHash: first.identityKeyHash,
      blocker: null
    })
    expect(first.walletStorageNamespace).toMatch(/^wallet-toolbox-rocksdb:bsv-testnet:demo-wallet:[0-9a-f]{16}$/)
    expect(first.identityKeyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(first)).not.toContain(rootKey.toHex())
    expect(JSON.stringify(inspected)).not.toContain(rootKey.toHex())
  })

  test('openRocksDbWalletFromSignerRef returns a usable redacted BRC-100 wallet context', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const walletPath = path.join(dir, 'open-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-open.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    const initialized = await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    const opened = await openRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    try {
      if (!opened.ok) throw new Error(String(opened.blocker))
      expect(opened).toMatchObject({
        ok: true,
        walletInitialized: true,
        walletStorageNamespace: initialized.walletStorageNamespace,
        network: 'bsv-testnet',
        identityKeyHash: initialized.identityKeyHash,
        blocker: null
      })
      expect(opened.context.wallet).toBeDefined()
      expect(opened.context.storage.getActiveStore()).toBe(initialized.walletStorageNamespace)
      expect(opened.context.activeStorage.isStorageProvider()).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(opened.context, 'rootKey')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(opened.context, 'keyDeriver')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(opened.context.wallet, 'rootKey')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(opened.context.wallet, 'keyDeriver')).toBe(false)
      expect(JSON.stringify({
        ok: opened.ok,
        walletStorageNamespace: opened.walletStorageNamespace,
        network: opened.network,
        identityKeyHash: opened.identityKeyHash,
        blocker: opened.blocker
      })).not.toContain(rootKey.toHex())
    } finally {
      if (opened.ok) opened.context.close()
    }
  })

  test('receive destination generation requires initialized wallet and exposes no secrets', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const walletPath = path.join(dir, 'receive-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-receive.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))

    await expect(getRocksDbWalletReceiveDestinationFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-wallet-not-initialized',
      receiveAddress: null,
      lockingScriptHex: null,
      secretMaterialExposed: false
    })

    await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    const destination = await getRocksDbWalletReceiveDestinationFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })

    expect(destination).toMatchObject({
      ok: true,
      walletInitialized: true,
      network: 'bsv-testnet',
      receiveAddress: rootKey.toAddress('testnet'),
      lockingScriptHex: new P2PKH().lock(rootKey.toAddress('testnet')).toHex(),
      secretMaterialExposed: false,
      blocker: null
    })
    expect(JSON.stringify(destination)).not.toContain(rootKey.toHex())
  })

  test('syncs spendable UTXO state and signs a transaction idempotently without returning secrets', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const walletPath = path.join(dir, 'production-signing-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })

    const sourceTx = new Transaction()
    sourceTx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1000
    })
    const sync = await importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      utxos: [{
        txid: sourceTx.id('hex'),
        vout: 0,
        satoshis: 1000,
        rawSourceTxHex: sourceTx.toHex()
      }]
    })

    expect(sync.imported).toBe(1)
    const recipient = PrivateKey.fromRandom().toAddress('testnet')
    const first = await signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-1',
      requiredOutpoints: [`${sourceTx.id('hex')}:0`],
      recipientOutputs: [{ satoshis: 250, address: recipient }],
      satsPerKb: 50,
      createdAt: 0
    })
    const replay = await signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-1',
      recipientOutputs: [{ satoshis: 250, address: recipient }],
      satsPerKb: 50,
      createdAt: 1
    })

    expect(first.ok).toBe(true)
    expect(first.status).toBe('signed')
    expect(first.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(first.rawTxHex).toMatch(/^[0-9a-f]+$/i)
    expect(first.rawTxHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.selectedOutpoints).toEqual([`${sourceTx.id('hex')}:0`])
    expect(first.replayed).toBe(false)
    expect(first.duplicateExternalEffects).toBe(0)
    expect(first.walletStorageNamespace).toBe(sync.walletStorageNamespace)
    expect(JSON.stringify(first)).not.toContain(rootKey.toHex())

    expect(replay.ok).toBe(true)
    expect(replay.replayed).toBe(true)
    expect(replay.txid).toBe(first.txid)
    expect(replay.rawTxHex).toBe(first.rawTxHex)
    expect(replay.selectedOutpoints).toEqual(first.selectedOutpoints)
    expect(replay.requiredOutpoints).toEqual([`${sourceTx.id('hex')}:0`])

    const replayWithSameRequiredOutpoint = await signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-1',
      requiredOutpoints: [`${sourceTx.id('hex')}:0`],
      recipientOutputs: [{ satoshis: 250, address: recipient }],
      satsPerKb: 50,
      createdAt: 1
    })
    expect(replayWithSameRequiredOutpoint.ok).toBe(true)
    expect(replayWithSameRequiredOutpoint.replayed).toBe(true)
    expect(replayWithSameRequiredOutpoint.selectedOutpoints).toEqual([`${sourceTx.id('hex')}:0`])
    expect(replayWithSameRequiredOutpoint.signingRecordSelectedOutpoints).toEqual([`${sourceTx.id('hex')}:0`])
    expect(replayWithSameRequiredOutpoint.signingRecordRequiredOutpoints).toEqual([`${sourceTx.id('hex')}:0`])

    await expect(signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-2',
      recipientOutputs: [{ satoshis: 250, address: recipient }],
      satsPerKb: 50,
      createdAt: 2
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-utxo-state-empty'
    })
  })

  test('lists spendable wallet UTXOs with public fields only', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const walletPath = path.join(dir, 'spendable-list-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-spendable-list.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })

    const sourceTx = new Transaction()
    sourceTx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1500
    })
    await importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      utxos: [{
        txid: sourceTx.id('hex'),
        vout: 0,
        satoshis: 1500,
        rawSourceTxHex: sourceTx.toHex()
      }]
    })

    const listed = await listRocksDbWalletSpendableUtxosFromSignerRef({
      walletPath,
      signerRef,
      network: 'bsv-testnet'
    })

    expect(listed).toMatchObject({
      ok: true,
      network: 'bsv-testnet',
      blocker: null,
      spendableUtxos: [{
        outpoint: `${sourceTx.id('hex')}:0`,
        txid: sourceTx.id('hex'),
        vout: 0,
        satoshis: 1500,
        network: 'bsv-testnet',
        signerRef,
        status: 'spendable'
      }]
    })
    expect(listed.spendableUtxos[0].walletStorageNamespace).toMatch(/^wallet-toolbox-rocksdb:bsv-testnet:demo-wallet:/)
    expect(JSON.stringify(listed)).not.toContain(sourceTx.toHex())
    expect(JSON.stringify(listed)).not.toContain(rootKey.toHex())
  })

  test('imports lists signs and replays wallet UTXOs by source basket', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const walletPath = path.join(dir, 'basket-source-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-basket-source.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })

    const hotLane1Tx = new Transaction()
    hotLane1Tx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1200
    })
    const hotLane2Tx = new Transaction()
    hotLane2Tx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1300
    })
    const hotLane1 = 'autonomous-commerce.hot-lane.1'
    const hotLane2 = 'autonomous-commerce.hot-lane.2'
    const explicitChange = 'autonomous-commerce.hot-lane.change'
    const hotLane1Outpoint = `${hotLane1Tx.id('hex')}:0`
    const hotLane2Outpoint = `${hotLane2Tx.id('hex')}:0`

    await importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      basketId: hotLane1,
      utxos: [{
        txid: hotLane1Tx.id('hex'),
        vout: 0,
        satoshis: 1200,
        rawSourceTxHex: hotLane1Tx.toHex()
      }]
    })
    await importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      utxos: [{
        txid: hotLane2Tx.id('hex'),
        vout: 0,
        satoshis: 1300,
        rawSourceTxHex: hotLane2Tx.toHex(),
        basketId: hotLane2
      }]
    })

    const listedLane1 = await listRocksDbWalletSpendableUtxosFromSignerRef({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      basketId: hotLane1
    })
    const listedLane2 = await listRocksDbWalletSpendableUtxosFromSignerRef({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      basketId: hotLane2
    })
    expect(listedLane1.spendableUtxos.map(utxo => utxo.outpoint)).toEqual([hotLane1Outpoint])
    expect(listedLane1.spendableUtxos[0].basketId).toBe(hotLane1)
    expect(listedLane2.spendableUtxos.map(utxo => utxo.outpoint)).toEqual([hotLane2Outpoint])

    await expect(signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-basket-wrong-required',
      sourceBasketId: hotLane1,
      requiredOutpoints: [hotLane2Outpoint],
      recipientOutputs: [{ satoshis: 250, address: PrivateKey.fromRandom().toAddress('testnet') }],
      satsPerKb: 50,
      createdAt: 0
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-required-utxo-outside-source-basket'
    })

    const signed = await signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-basket-source',
      sourceBasketId: hotLane1,
      changeBasketId: explicitChange,
      requiredOutpoints: [hotLane1Outpoint],
      recipientOutputs: [{ satoshis: 250, address: PrivateKey.fromRandom().toAddress('testnet') }],
      satsPerKb: 50,
      createdAt: 0
    })
    expect(signed.ok).toBe(true)
    expect(signed.selectedOutpoints).toEqual([hotLane1Outpoint])
    expect(signed.requiredOutpoints).toEqual([hotLane1Outpoint])
    expect(signed.sourceBasketId).toBe(hotLane1)
    expect(signed.changeBasketId).toBe(explicitChange)
    expect(signed.signingRecordSourceBasketId).toBe(hotLane1)
    expect(signed.signingRecordChangeBasketId).toBe(explicitChange)

    await expect(signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-basket-source',
      sourceBasketId: hotLane2,
      requiredOutpoints: [hotLane1Outpoint],
      recipientOutputs: [{ satoshis: 250, address: PrivateKey.fromRandom().toAddress('testnet') }],
      satsPerKb: 50,
      createdAt: 1
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-source-basket-mismatch',
      signingRecordSourceBasketId: hotLane1
    })

    const replay = await signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-basket-source',
      sourceBasketId: hotLane1,
      requiredOutpoints: [hotLane1Outpoint],
      recipientOutputs: [{ satoshis: 250, address: PrivateKey.fromRandom().toAddress('testnet') }],
      satsPerKb: 50,
      createdAt: 2
    })
    expect(replay.ok).toBe(true)
    expect(replay.replayed).toBe(true)
    expect(replay.requiredOutpoints).toEqual([hotLane1Outpoint])
    expect(replay.sourceBasketId).toBe(hotLane1)
  })

  test('signing fails closed when required outpoint is not available', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-required-outpoint.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    const walletPath = path.join(dir, 'required-outpoint.rocksdb')
    await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })

    const sourceTx = new Transaction()
    sourceTx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1000
    })
    await importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      utxos: [{
        txid: sourceTx.id('hex'),
        vout: 0,
        satoshis: 1000,
        rawSourceTxHex: sourceTx.toHex()
      }]
    })

    const recipient = PrivateKey.fromRandom().toAddress('testnet')
    await expect(signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-required-outpoint',
      requiredOutpoints: ['0'.repeat(64) + ':0'],
      recipientOutputs: [{ satoshis: 250, address: recipient }],
      satsPerKb: 50,
      createdAt: 0
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-required-utxo-unavailable'
    })
  })

  test('signing replay fails closed when stored selected outpoint differs from required outpoint', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-replay-required-outpoint.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    const walletPath = path.join(dir, 'replay-required-outpoint.rocksdb')
    await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })

    const firstSourceTx = new Transaction()
    firstSourceTx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1000
    })
    const secondSourceTx = new Transaction()
    secondSourceTx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1100
    })
    await importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      utxos: [{
        txid: firstSourceTx.id('hex'),
        vout: 0,
        satoshis: 1000,
        rawSourceTxHex: firstSourceTx.toHex()
      }, {
        txid: secondSourceTx.id('hex'),
        vout: 0,
        satoshis: 1100,
        rawSourceTxHex: secondSourceTx.toHex()
      }]
    })

    const recipient = PrivateKey.fromRandom().toAddress('testnet')
    const firstOutpoint = `${firstSourceTx.id('hex')}:0`
    const secondOutpoint = `${secondSourceTx.id('hex')}:0`
    const first = await signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-replay-required-mismatch',
      requiredOutpoints: [firstOutpoint],
      recipientOutputs: [{ satoshis: 250, address: recipient }],
      satsPerKb: 50,
      createdAt: 0
    })
    expect(first.ok).toBe(true)
    expect(first.selectedOutpoints).toEqual([firstOutpoint])
    expect(first.requiredOutpoints).toEqual([firstOutpoint])

    await expect(signRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-replay-required-mismatch',
      requiredOutpoints: [secondOutpoint],
      recipientOutputs: [{ satoshis: 250, address: recipient }],
      satsPerKb: 50,
      createdAt: 1
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-reserved-outpoint-mismatch',
      signingRecordTxid: first.txid,
      signingRecordSelectedOutpoints: [firstOutpoint],
      signingRecordRequiredOutpoints: [firstOutpoint]
    })
  })

  test('dry-run blocks uninitialized and initialized-but-unfunded wallets without signing', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-dry-run.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))

    await expect(dryRunRocksDbWalletPayment({
      signerRef,
      walletPath: '',
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'dry-run-missing-path',
      recipientOutputs: [{ satoshis: 1, address: PrivateKey.fromRandom().toAddress('testnet') }]
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-wallet-path-missing'
    })

    await expect(dryRunRocksDbWalletPayment({
      signerRef: 'not-a-signer-ref',
      walletPath: path.join(dir, 'dry-run-invalid-ref.rocksdb'),
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'dry-run-invalid-ref',
      recipientOutputs: [{ satoshis: 1, address: PrivateKey.fromRandom().toAddress('testnet') }]
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'signer-ref-invalid'
    })

    await expect(dryRunRocksDbWalletPayment({
      signerRef,
      walletPath: path.join(dir, 'dry-run-missing-wallet.rocksdb'),
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'dry-run-1',
      recipientOutputs: [{ satoshis: 1, address: PrivateKey.fromRandom().toAddress('testnet') }]
    })).resolves.toMatchObject({
      ok: false,
      status: 'blocked',
      txid: null,
      rawTxHex: null,
      blocker: 'wallet-toolbox-wallet-not-initialized'
    })

    const walletPath = path.join(dir, 'dry-run-empty-wallet.rocksdb')
    const initialized = await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    expect(initialized.ok).toBe(true)

    const dryRun = await dryRunRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'dry-run-2',
      recipientOutputs: [{ satoshis: 1, to: 'dry-run@example.invalid' }]
    })
    expect(dryRun).toMatchObject({
      ok: false,
      status: 'blocked',
      txid: null,
      rawTxHex: null,
      rawTxHash: null,
      duplicateExternalEffects: 0,
      unknownOutcome: false,
      blocker: 'wallet-toolbox-utxo-state-empty'
    })
    expect(JSON.stringify(dryRun)).not.toContain(rootKey.toHex())

    await expect(dryRunRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath: path.join(dir, 'missing-key-config.json'),
      network: 'bsv-testnet',
      idempotencyKey: 'dry-run-missing-key',
      recipientOutputs: [{ satoshis: 1, address: PrivateKey.fromRandom().toAddress('testnet') }]
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-local-key-missing'
    })
  })

  test('production signing blocks mismatched, uninitialized, and unfunded requests', async () => {
    await expect(signRocksDbWalletPayment({
      signerRef: 'wallet-toolbox://mainnet/demo-wallet',
      walletPath: path.join(dir, 'wallet.rocksdb'),
      localKeyConfigPath: path.join(dir, 'missing.json'),
      network: 'bsv-testnet',
      idempotencyKey: 'idem-2',
      recipientOutputs: [{ satoshis: 1, address: PrivateKey.fromRandom().toAddress('testnet') }]
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'signer-ref-network-mismatch'
    })

    await expect(signRocksDbWalletPayment({
      signerRef: 'wallet-toolbox://testnet/demo-wallet',
      walletPath: path.join(dir, 'missing-wallet.rocksdb'),
      localKeyConfigPath: path.join(dir, 'missing.json'),
      network: 'bsv-testnet',
      idempotencyKey: 'idem-3',
      recipientOutputs: [{ satoshis: 1, address: PrivateKey.fromRandom().toAddress('testnet') }]
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-wallet-not-initialized'
    })

    const walletPath = path.join(dir, 'empty-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-empty.json')
    const rootKey = PrivateKey.fromRandom()
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))
    await initializeRocksDbWalletFromSignerRef({
      signerRef: 'wallet-toolbox://testnet/demo-wallet',
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    await syncRocksDbWalletUtxos({
      walletPath,
      signerRef: 'wallet-toolbox://testnet/demo-wallet',
      network: 'bsv-testnet',
      utxos: []
    })

    await expect(signRocksDbWalletPayment({
      signerRef: 'wallet-toolbox://testnet/demo-wallet',
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'idem-4',
      recipientOutputs: [{ satoshis: 1, address: PrivateKey.fromRandom().toAddress('testnet') }]
    })).resolves.toMatchObject({
      ok: false,
      blocker: 'wallet-toolbox-utxo-state-empty'
    })
  })

  test('UTXO import validates initialized wallet and source shape', async () => {
    const signerRef = 'wallet-toolbox://testnet/demo-wallet'
    const rootKey = PrivateKey.fromRandom()
    const walletPath = path.join(dir, 'utxo-import-wallet.rocksdb')
    const localKeyConfigPath = path.join(dir, 'toolbox-local-key-utxo-import.json')
    await writeFile(localKeyConfigPath, JSON.stringify({ rootKeyHex: rootKey.toHex() }))

    await expect(importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      utxos: []
    })).rejects.toThrow(/wallet-toolbox-wallet-not-initialized/)

    await initializeRocksDbWalletFromSignerRef({
      signerRef,
      expectedNetwork: 'bsv-testnet',
      walletPath,
      localKeyConfigPath
    })
    await expect(importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      utxos: [{
        txid: 'not-a-txid',
        vout: 0,
        satoshis: 1,
        rawSourceTxHex: '00'
      }]
    })).rejects.toThrow(/ROCKSDB_WALLET_UTXO_TXID_INVALID/)

    const sourceTx = new Transaction()
    sourceTx.addOutput({
      lockingScript: new P2PKH().lock(rootKey.toAddress('testnet')),
      satoshis: 1000
    })
    const validUtxo = {
      txid: sourceTx.id('hex'),
      vout: 0,
      satoshis: 1000,
      rawSourceTxHex: sourceTx.toHex()
    }
    await expect(importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      localKeyConfigPath,
      requireWalletOwnership: true,
      utxos: [validUtxo]
    })).resolves.toMatchObject({
      ok: true,
      imported: 1
    })
    await expect(dryRunRocksDbWalletPayment({
      signerRef,
      walletPath,
      localKeyConfigPath,
      network: 'bsv-testnet',
      idempotencyKey: 'dry-run-imported-utxo',
      recipientOutputs: [{ satoshis: 1, to: 'dry-run@example.invalid' }]
    })).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      txid: null,
      rawTxHex: null,
      rawTxHash: null,
      blocker: null
    })
    await expect(importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      localKeyConfigPath,
      requireWalletOwnership: true,
      utxos: [validUtxo]
    })).resolves.toMatchObject({
      ok: true,
      imported: 1
    })
    const unownedSourceTx = new Transaction()
    unownedSourceTx.addOutput({
      lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toAddress('testnet')),
      satoshis: 1000
    })
    await expect(importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      localKeyConfigPath,
      requireWalletOwnership: true,
      utxos: [{
        txid: unownedSourceTx.id('hex'),
        vout: 0,
        satoshis: 1000,
        rawSourceTxHex: unownedSourceTx.toHex()
      }]
    })).rejects.toThrow(/ROCKSDB_WALLET_UTXO_OWNERSHIP_UNVERIFIED/)
    await expect(importRocksDbWalletUtxos({
      walletPath,
      signerRef,
      network: 'bsv-testnet',
      localKeyConfigPath,
      requireWalletOwnership: true,
      utxos: [{
        ...validUtxo,
        rawSourceTxHex: ''
      }]
    })).rejects.toThrow(/ROCKSDB_WALLET_UTXO_RAW_TX_INVALID/)
    await expect(importRocksDbWalletUtxos({
      walletPath,
      signerRef: 'wallet-toolbox://mainnet/demo-wallet',
      network: 'bsv-testnet',
      utxos: [validUtxo]
    })).rejects.toThrow(/signer-ref-network-mismatch/)
    for (const status of ['reserved', 'spent', 'quarantined', 'unknown'] as const) {
      await expect(importRocksDbWalletUtxos({
        walletPath,
        signerRef,
        network: 'bsv-testnet',
        utxos: [{ ...validUtxo, vout: validUtxo.vout + 1, status }]
      })).rejects.toThrow(new RegExp(`ROCKSDB_WALLET_UTXO_STATUS_${status.toUpperCase()}_NOT_IMPORTABLE`))
    }
  })

  test('RocksDB entrypoint exposes the standalone wallet API', () => {
    expect(typeof rocksDbEntrypoint.initializeRocksDbWalletFromSignerRef).toBe('function')
    expect(typeof rocksDbEntrypoint.inspectRocksDbWalletFromSignerRef).toBe('function')
    expect(typeof rocksDbEntrypoint.openRocksDbWalletFromSignerRef).toBe('function')
    expect(typeof rocksDbEntrypoint.getRocksDbWalletReceiveDestinationFromSignerRef).toBe('function')
    expect(typeof rocksDbEntrypoint.dryRunRocksDbWalletPayment).toBe('function')
    expect(typeof rocksDbEntrypoint.signRocksDbWalletPayment).toBe('function')
    expect(typeof rocksDbEntrypoint.importRocksDbWalletUtxos).toBe('function')
    expect(typeof rocksDbEntrypoint.syncRocksDbWalletUtxos).toBe('function')
  })
})
