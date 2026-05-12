import {
  parseWalletToolboxSignerRef,
  type WalletToolboxSignerRefNetwork
} from './SignerRef'

export type RocksDbWalletSignerRefBlocker =
  | 'signer-ref-invalid'
  | 'signer-ref-network-mismatch'
  | 'signer-ref-placeholder'
  | 'signer-ref-secret-like'
  | 'unsupported-signer-ref-scheme'
  | 'wallet-toolbox-wallet-not-initialized'
  | 'wallet-identity-not-found'

export interface ResolveRocksDbWalletSignerRefInput {
  signerRef: string
  expectedNetwork?: WalletToolboxSignerRefNetwork | 'testnet' | 'mainnet'
  walletInitialized?: boolean
}

export interface ResolveRocksDbWalletSignerRefResult {
  ok: boolean
  signerRefResolved: boolean
  network: WalletToolboxSignerRefNetwork | null
  ref: string | null
  walletStorageNamespace: string | null
  secretMaterialRequired: false
  readyForDryRun: boolean
  walletInitialized: boolean
  blocker: RocksDbWalletSignerRefBlocker | null
}

export function resolveRocksDbWalletSignerRef (input: ResolveRocksDbWalletSignerRefInput): ResolveRocksDbWalletSignerRefResult {
  const parsed = parseWalletToolboxSignerRef({
    signerRef: input.signerRef,
    expectedNetwork: input.expectedNetwork
  })

  if (!parsed.ok || parsed.parsed === null) {
    return {
      ok: false,
      signerRefResolved: false,
      network: null,
      ref: null,
      walletStorageNamespace: null,
      secretMaterialRequired: false,
      readyForDryRun: false,
      walletInitialized: false,
      blocker: parsed.blocker
    }
  }

  const walletInitialized = input.walletInitialized === true
  return {
    ok: true,
    signerRefResolved: true,
    network: parsed.parsed.network,
    ref: parsed.parsed.ref,
    walletStorageNamespace: parsed.parsed.walletStorageNamespace,
    secretMaterialRequired: false,
    readyForDryRun: true,
    walletInitialized,
    blocker: walletInitialized ? null : 'wallet-toolbox-wallet-not-initialized'
  }
}
