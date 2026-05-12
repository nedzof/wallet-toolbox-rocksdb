import { CachedKeyDeriver, PrivateKey } from '@bsv/sdk'
import { Monitor } from './monitor/Monitor'
import { PrivilegedKeyManager } from './sdk/PrivilegedKeyManager'
import type { Chain } from './sdk/types'
import { Services } from './services/Services'
import { RocksDbWalletStore, type RocksDbWalletStoreOptions } from './storage/rocksdb'
import { WalletStorageManager } from './storage/WalletStorageManager'
import type { SetupWallet } from './SetupWallet'
import { Wallet } from './Wallet'

export interface CreateRocksDbWalletArgs {
  chain: Chain
  rootKeyHex: string
  path: string
  namespace?: string
  storageName?: string
  storageIdentityKey?: string
  privilegedKeyGetter?: () => Promise<PrivateKey>
}

export interface SetupRocksDbWallet extends SetupWallet {
  activeStorage: RocksDbWalletStore
}

export async function createRocksDbWallet (args: CreateRocksDbWalletArgs): Promise<SetupRocksDbWallet> {
  const rootKeyHex = String(args.rootKeyHex ?? '').trim()
  if (rootKeyHex === '') throw new Error('ROCKSDB_WALLET_ROOT_KEY_REQUIRED')
  const rootKey = PrivateKey.fromHex(rootKeyHex)
  const identityKey = rootKey.toPublicKey().toString()
  const keyDeriver = new CachedKeyDeriver(rootKey)
  const activeStorage = await RocksDbWalletStore.open(storageOptions(args))
  const storage = new WalletStorageManager(identityKey, activeStorage)
  await storage.makeAvailable()
  const services = new Services(Services.createDefaultOptions(args.chain))
  const monitor = new Monitor(Monitor.createDefaultWalletMonitorOptions(args.chain, storage, services, undefined, 'default'))
  const privilegedKeyManager = args.privilegedKeyGetter !== undefined
    ? new PrivilegedKeyManager(args.privilegedKeyGetter)
    : undefined
  const wallet = new Wallet({
    chain: args.chain,
    keyDeriver,
    storage,
    services,
    monitor,
    privilegedKeyManager
  })

  return {
    rootKey,
    identityKey,
    keyDeriver,
    chain: args.chain,
    storage,
    services,
    monitor,
    wallet,
    activeStorage
  }
}

function storageOptions (args: CreateRocksDbWalletArgs): RocksDbWalletStoreOptions {
  return {
    path: args.path,
    namespace: args.namespace,
    chain: args.chain,
    storageName: args.storageName ?? `RocksDB wallet ${args.chain}`,
    storageIdentityKey: args.storageIdentityKey ?? `rocksdb:${args.chain}:${args.namespace ?? 'wallet-toolbox'}`
  }
}
