import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { CachedKeyDeriver, P2PKH, PrivateKey } from '@bsv/sdk'
import { Monitor } from './monitor/Monitor'
import { PrivilegedKeyManager } from './sdk/PrivilegedKeyManager'
import type { Chain } from './sdk/types'
import { Services } from './services/Services'
import { RocksDbWalletStore, type RocksDbWalletStoreOptions } from './storage/rocksdb'
import { WalletStorageManager } from './storage/WalletStorageManager'
import type { SetupWallet } from './SetupWallet'
import { Wallet } from './Wallet'
import {
  parseWalletToolboxSignerRef,
  type WalletToolboxSignerRefNetwork
} from './signer/SignerRef'

export const ROCKSDB_WALLET_IDENTITY_KEY = 'wallet!identity' as const
export const ROCKSDB_WALLET_IDENTITY_SCHEMA_VERSION = 1 as const

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

export interface InitializeRocksDbWalletFromSignerRefArgs extends Omit<CreateRocksDbWalletArgs, 'chain' | 'namespace' | 'storageIdentityKey' | 'rootKeyHex' | 'path'> {
  signerRef: string
  expectedNetwork?: WalletToolboxSignerRefNetwork | 'testnet' | 'mainnet'
  walletPath?: string
  path?: string
  rootKeyHex?: string
  localKeyConfigPath?: string | null
}

export interface InspectRocksDbWalletFromSignerRefArgs {
  signerRef: string
  expectedNetwork?: WalletToolboxSignerRefNetwork | 'testnet' | 'mainnet'
  walletPath: string
}

export interface OpenRocksDbWalletFromSignerRefArgs extends InspectRocksDbWalletFromSignerRefArgs {
  localKeyConfigPath?: string | null
  storageName?: string
  privilegedKeyGetter?: () => Promise<PrivateKey>
}

export interface GetRocksDbWalletReceiveDestinationFromSignerRefArgs extends InspectRocksDbWalletFromSignerRefArgs {
  localKeyConfigPath?: string | null
}

export interface RocksDbWalletIdentityMarker {
  schemaVersion: typeof ROCKSDB_WALLET_IDENTITY_SCHEMA_VERSION
  signerRef: string
  network: WalletToolboxSignerRefNetwork
  walletStorageNamespace: string
  identityKeyHash: string
  initializedAt: string
}

export interface RocksDbWalletInspectionResult {
  ok: boolean
  walletInitialized: boolean
  walletStorageNamespace: string | null
  network: WalletToolboxSignerRefNetwork | null
  identityKeyHash: string | null
  blocker:
    | 'signer-ref-invalid'
    | 'signer-ref-network-mismatch'
    | 'signer-ref-placeholder'
    | 'signer-ref-secret-like'
    | 'unsupported-signer-ref-scheme'
    | 'wallet-toolbox-wallet-path-missing'
    | 'wallet-toolbox-wallet-not-initialized'
    | 'wallet-toolbox-wallet-identity-mismatch'
    | 'wallet-toolbox-local-key-config-missing'
    | 'wallet-toolbox-local-key-missing'
    | null
}

export type RocksDbWalletReceiveDestinationResult =
  | (RocksDbWalletInspectionResult & {
      ok: false
      receiveAddress: null
      lockingScriptHex: null
      secretMaterialExposed: false
    })
  | {
      ok: true
      walletInitialized: true
      walletStorageNamespace: string
      network: WalletToolboxSignerRefNetwork
      identityKeyHash: string
      blocker: null
      receiveAddress: string
      lockingScriptHex: string
      secretMaterialExposed: false
    }

export interface RocksDbWalletContext {
  chain: Chain
  walletStorageNamespace: string
  network: WalletToolboxSignerRefNetwork
  identityKeyHash: string
  wallet: RocksDbWalletFacade
  storage: WalletStorageManager
  services: Services
  monitor: Monitor
  activeStorage: RocksDbWalletStore
  close: () => void
}

export type RocksDbWalletFacade = Pick<Wallet,
  | 'getIdentityKey'
  | 'getPublicKey'
  | 'revealCounterpartyKeyLinkage'
  | 'revealSpecificKeyLinkage'
  | 'encrypt'
  | 'decrypt'
  | 'createHmac'
  | 'verifyHmac'
  | 'createSignature'
  | 'verifySignature'
  | 'listActions'
  | 'listOutputs'
  | 'listCertificates'
  | 'acquireCertificate'
  | 'relinquishCertificate'
  | 'proveCertificate'
  | 'discoverByIdentityKey'
  | 'discoverByAttributes'
  | 'createAction'
  | 'signAction'
  | 'internalizeAction'
  | 'abortAction'
  | 'relinquishOutput'
  | 'isAuthenticated'
  | 'waitForAuthentication'
  | 'getHeight'
  | 'getHeaderForHeight'
  | 'getNetwork'
  | 'getVersion'
>

export type OpenRocksDbWalletFromSignerRefResult =
  | (RocksDbWalletInspectionResult & { ok: false, context: null })
  | {
      ok: true
      walletInitialized: true
      walletStorageNamespace: string
      network: WalletToolboxSignerRefNetwork
      identityKeyHash: string
      blocker: null
      context: RocksDbWalletContext
    }

interface LocalKeyConfig {
  rootKeyHex?: string
  signers?: Record<string, { rootKeyHex?: string }>
  signerRefs?: Record<string, { rootKeyHex?: string }>
  wallets?: Record<string, { rootKeyHex?: string }>
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

export async function initializeRocksDbWalletFromSignerRef (args: InitializeRocksDbWalletFromSignerRefArgs): Promise<RocksDbWalletInspectionResult> {
  const parsed = parseWalletToolboxSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: args.expectedNetwork
  })
  if (!parsed.ok || parsed.parsed === null) {
    return inspectionBlocked(parsed.blocker, null, null)
  }
  const walletPath = normalizeText(args.walletPath ?? args.path)
  if (walletPath === null) return inspectionBlocked('wallet-toolbox-wallet-path-missing', parsed.parsed.network, parsed.parsed.walletStorageNamespace)
  const rootKeyHex = normalizeText(args.rootKeyHex) ?? await resolveRootKeyHex(args.localKeyConfigPath, args.signerRef, parsed.parsed.ref)
  if (rootKeyHex === null) {
    return inspectionBlocked(
      args.localKeyConfigPath == null ? 'wallet-toolbox-local-key-config-missing' : 'wallet-toolbox-local-key-missing',
      parsed.parsed.network,
      parsed.parsed.walletStorageNamespace
    )
  }

  const setup = await createRocksDbWallet({
    ...args,
    rootKeyHex,
    path: walletPath,
    chain: chainFromSignerRefNetwork(parsed.parsed.network),
    namespace: parsed.parsed.walletStorageNamespace,
    storageName: args.storageName ?? `RocksDB wallet ${parsed.parsed.network}:${parsed.parsed.ref}`,
    storageIdentityKey: parsed.parsed.walletStorageNamespace
  })
  try {
    const identityKeyHash = sha256(setup.identityKey)
    await setup.activeStorage.put({
      key: ROCKSDB_WALLET_IDENTITY_KEY,
      value: {
        schemaVersion: ROCKSDB_WALLET_IDENTITY_SCHEMA_VERSION,
        signerRef: args.signerRef,
        network: parsed.parsed.network,
        walletStorageNamespace: parsed.parsed.walletStorageNamespace,
        identityKeyHash,
        initializedAt: new Date().toISOString()
      }
    })
    return {
      ok: true,
      walletInitialized: true,
      walletStorageNamespace: parsed.parsed.walletStorageNamespace,
      network: parsed.parsed.network,
      identityKeyHash,
      blocker: null
    }
  } finally {
    setup.activeStorage.close()
  }
}

export async function inspectRocksDbWalletFromSignerRef (args: InspectRocksDbWalletFromSignerRefArgs): Promise<RocksDbWalletInspectionResult> {
  const parsed = parseWalletToolboxSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: args.expectedNetwork
  })
  if (!parsed.ok || parsed.parsed === null) return inspectionBlocked(parsed.blocker, null, null)
  const walletPath = normalizeText(args.walletPath)
  if (walletPath === null) return inspectionBlocked('wallet-toolbox-wallet-path-missing', parsed.parsed.network, parsed.parsed.walletStorageNamespace)
  const store = await RocksDbWalletStore.open({ path: walletPath, namespace: parsed.parsed.walletStorageNamespace })
  try {
    const identity = await store.get<RocksDbWalletIdentityMarker>(ROCKSDB_WALLET_IDENTITY_KEY)
    if (identity === undefined) return inspectionBlocked('wallet-toolbox-wallet-not-initialized', parsed.parsed.network, parsed.parsed.walletStorageNamespace)
    const identityKeyHash = normalizeText(identity.value.identityKeyHash)
    if (
      identity.value.schemaVersion !== ROCKSDB_WALLET_IDENTITY_SCHEMA_VERSION ||
      identity.value.network !== parsed.parsed.network ||
      identity.value.walletStorageNamespace !== parsed.parsed.walletStorageNamespace ||
      identityKeyHash === null
    ) {
      return inspectionBlocked('wallet-toolbox-wallet-identity-mismatch', parsed.parsed.network, parsed.parsed.walletStorageNamespace)
    }
    return {
      ok: true,
      walletInitialized: true,
      walletStorageNamespace: parsed.parsed.walletStorageNamespace,
      network: parsed.parsed.network,
      identityKeyHash,
      blocker: null
    }
  } finally {
    store.close()
  }
}

export async function openRocksDbWalletFromSignerRef (args: OpenRocksDbWalletFromSignerRefArgs): Promise<OpenRocksDbWalletFromSignerRefResult> {
  const parsed = parseWalletToolboxSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: args.expectedNetwork
  })
  if (!parsed.ok || parsed.parsed === null) return openBlocked(parsed.blocker, null, null)
  const walletPath = normalizeText(args.walletPath)
  if (walletPath === null) return openBlocked('wallet-toolbox-wallet-path-missing', parsed.parsed.network, parsed.parsed.walletStorageNamespace)

  const inspection = await inspectRocksDbWalletFromSignerRef(args)
  if (inspection.ok !== true || inspection.identityKeyHash === null) return openBlocked(inspection.blocker, inspection.network, inspection.walletStorageNamespace)

  const rootKeyHex = await resolveRootKeyHex(args.localKeyConfigPath, args.signerRef, parsed.parsed.ref)
  if (rootKeyHex === null) {
    return openBlocked(
      args.localKeyConfigPath == null ? 'wallet-toolbox-local-key-config-missing' : 'wallet-toolbox-local-key-missing',
      parsed.parsed.network,
      parsed.parsed.walletStorageNamespace
    )
  }

  const setup = await createRocksDbWallet({
    ...args,
    rootKeyHex,
    path: walletPath,
    chain: chainFromSignerRefNetwork(parsed.parsed.network),
    namespace: parsed.parsed.walletStorageNamespace,
    storageName: args.storageName ?? `RocksDB wallet ${parsed.parsed.network}:${parsed.parsed.ref}`,
    storageIdentityKey: parsed.parsed.walletStorageNamespace
  })
  const identityKeyHash = sha256(setup.identityKey)
  if (identityKeyHash !== inspection.identityKeyHash) {
    setup.activeStorage.close()
    return openBlocked('wallet-toolbox-wallet-identity-mismatch', parsed.parsed.network, parsed.parsed.walletStorageNamespace)
  }

  return {
    ok: true,
    walletInitialized: true,
    walletStorageNamespace: parsed.parsed.walletStorageNamespace,
    network: parsed.parsed.network,
    identityKeyHash,
    blocker: null,
    context: {
      chain: setup.chain,
      walletStorageNamespace: parsed.parsed.walletStorageNamespace,
      network: parsed.parsed.network,
      identityKeyHash,
      wallet: walletFacade(setup.wallet),
      storage: setup.storage,
      services: setup.services,
      monitor: setup.monitor,
      activeStorage: setup.activeStorage,
      close: () => setup.activeStorage.close()
    }
  }
}

export async function getRocksDbWalletReceiveDestinationFromSignerRef (
  args: GetRocksDbWalletReceiveDestinationFromSignerRefArgs
): Promise<RocksDbWalletReceiveDestinationResult> {
  const parsed = parseWalletToolboxSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: args.expectedNetwork
  })
  if (!parsed.ok || parsed.parsed === null) return receiveBlocked(parsed.blocker, null, null)

  const inspection = await inspectRocksDbWalletFromSignerRef(args)
  if (inspection.ok !== true || inspection.identityKeyHash === null) {
    return receiveBlocked(inspection.blocker, inspection.network, inspection.walletStorageNamespace)
  }

  const rootKeyHex = await resolveRootKeyHex(args.localKeyConfigPath, args.signerRef, parsed.parsed.ref)
  if (rootKeyHex === null) {
    return receiveBlocked(
      args.localKeyConfigPath == null ? 'wallet-toolbox-local-key-config-missing' : 'wallet-toolbox-local-key-missing',
      parsed.parsed.network,
      parsed.parsed.walletStorageNamespace
    )
  }

  const rootKey = PrivateKey.fromHex(rootKeyHex)
  const identityKeyHash = sha256(rootKey.toPublicKey().toString())
  if (identityKeyHash !== inspection.identityKeyHash) {
    return receiveBlocked('wallet-toolbox-wallet-identity-mismatch', parsed.parsed.network, parsed.parsed.walletStorageNamespace)
  }

  const receiveAddress = rootKey.toAddress(parsed.parsed.network === 'bsv-mainnet' ? 'mainnet' : 'testnet')
  const lockingScriptHex = new P2PKH().lock(receiveAddress).toHex()
  return {
    ok: true,
    walletInitialized: true,
    walletStorageNamespace: parsed.parsed.walletStorageNamespace,
    network: parsed.parsed.network,
    identityKeyHash,
    blocker: null,
    receiveAddress,
    lockingScriptHex,
    secretMaterialExposed: false
  }
}

function walletFacade (wallet: Wallet): RocksDbWalletFacade {
  return {
    getIdentityKey: wallet.getIdentityKey.bind(wallet),
    getPublicKey: wallet.getPublicKey.bind(wallet),
    revealCounterpartyKeyLinkage: wallet.revealCounterpartyKeyLinkage.bind(wallet),
    revealSpecificKeyLinkage: wallet.revealSpecificKeyLinkage.bind(wallet),
    encrypt: wallet.encrypt.bind(wallet),
    decrypt: wallet.decrypt.bind(wallet),
    createHmac: wallet.createHmac.bind(wallet),
    verifyHmac: wallet.verifyHmac.bind(wallet),
    createSignature: wallet.createSignature.bind(wallet),
    verifySignature: wallet.verifySignature.bind(wallet),
    listActions: wallet.listActions.bind(wallet),
    listOutputs: wallet.listOutputs.bind(wallet),
    listCertificates: wallet.listCertificates.bind(wallet),
    acquireCertificate: wallet.acquireCertificate.bind(wallet),
    relinquishCertificate: wallet.relinquishCertificate.bind(wallet),
    proveCertificate: wallet.proveCertificate.bind(wallet),
    discoverByIdentityKey: wallet.discoverByIdentityKey.bind(wallet),
    discoverByAttributes: wallet.discoverByAttributes.bind(wallet),
    createAction: wallet.createAction.bind(wallet),
    signAction: wallet.signAction.bind(wallet),
    internalizeAction: wallet.internalizeAction.bind(wallet),
    abortAction: wallet.abortAction.bind(wallet),
    relinquishOutput: wallet.relinquishOutput.bind(wallet),
    isAuthenticated: wallet.isAuthenticated.bind(wallet),
    waitForAuthentication: wallet.waitForAuthentication.bind(wallet),
    getHeight: wallet.getHeight.bind(wallet),
    getHeaderForHeight: wallet.getHeaderForHeight.bind(wallet),
    getNetwork: wallet.getNetwork.bind(wallet),
    getVersion: wallet.getVersion.bind(wallet)
  }
}

function openBlocked (
  blocker: RocksDbWalletInspectionResult['blocker'],
  network: WalletToolboxSignerRefNetwork | null,
  walletStorageNamespace: string | null
): OpenRocksDbWalletFromSignerRefResult {
  return {
    ok: false,
    walletInitialized: false,
    walletStorageNamespace,
    network,
    identityKeyHash: null,
    blocker,
    context: null
  }
}

function receiveBlocked (
  blocker: RocksDbWalletInspectionResult['blocker'],
  network: WalletToolboxSignerRefNetwork | null,
  walletStorageNamespace: string | null
): RocksDbWalletReceiveDestinationResult {
  return {
    ok: false,
    walletInitialized: false,
    walletStorageNamespace,
    network,
    identityKeyHash: null,
    blocker,
    receiveAddress: null,
    lockingScriptHex: null,
    secretMaterialExposed: false
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

function chainFromSignerRefNetwork (network: WalletToolboxSignerRefNetwork): Chain {
  return network === 'bsv-mainnet' ? 'main' : 'test'
}

async function resolveRootKeyHex (localKeyConfigPath: string | null | undefined, signerRef: string, ref: string): Promise<string | null> {
  const filePath = normalizeText(localKeyConfigPath)
  if (filePath === null) return null
  let config: LocalKeyConfig
  try {
    config = JSON.parse(await readFile(filePath, 'utf8')) as LocalKeyConfig
  } catch {
    return null
  }
  const candidates = [
    config.signers?.[signerRef]?.rootKeyHex,
    config.signerRefs?.[signerRef]?.rootKeyHex,
    config.wallets?.[ref]?.rootKeyHex,
    config.rootKeyHex
  ]
  return candidates.map(value => normalizeText(value)).find(value => value != null && /^[0-9a-f]{64}$/i.test(value)) ?? null
}

function inspectionBlocked (
  blocker: RocksDbWalletInspectionResult['blocker'],
  network: WalletToolboxSignerRefNetwork | null,
  walletStorageNamespace: string | null
): RocksDbWalletInspectionResult {
  return {
    ok: false,
    walletInitialized: false,
    walletStorageNamespace,
    network,
    identityKeyHash: null,
    blocker
  }
}

function normalizeText (value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized !== '' ? normalized : null
}

function sha256 (value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
