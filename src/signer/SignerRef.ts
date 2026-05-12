import { createHash } from 'crypto'

export type WalletToolboxSignerRefNetwork = 'bsv-testnet' | 'bsv-mainnet'

export type WalletToolboxSignerRefBlocker =
  | 'signer-ref-invalid'
  | 'signer-ref-network-mismatch'
  | 'signer-ref-placeholder'
  | 'signer-ref-secret-like'
  | 'unsupported-signer-ref-scheme'

export interface ParsedWalletToolboxSignerRef {
  scheme: 'wallet-toolbox'
  network: WalletToolboxSignerRefNetwork
  ref: string
  walletStorageNamespace: string
}

export interface ParseWalletToolboxSignerRefInput {
  signerRef: string
  expectedNetwork?: WalletToolboxSignerRefNetwork | 'testnet' | 'mainnet'
}

export interface ParseWalletToolboxSignerRefResult {
  ok: boolean
  signerRefResolved: boolean
  blocker: WalletToolboxSignerRefBlocker | null
  parsed: ParsedWalletToolboxSignerRef | null
}

export function parseWalletToolboxSignerRef (input: ParseWalletToolboxSignerRefInput): ParseWalletToolboxSignerRefResult {
  const signerRef = normalizeText(input.signerRef)
  const expectedNetwork = normalizeNetwork(input.expectedNetwork)

  if (signerRef === null) return unresolved('signer-ref-invalid')
  if (isPlaceholderSignerRef(signerRef)) return unresolved('signer-ref-placeholder')
  if (isSecretLikeSignerRef(signerRef)) return unresolved('signer-ref-secret-like')

  let url: URL
  try {
    url = new URL(signerRef)
  } catch {
    return unresolved('signer-ref-invalid')
  }

  const scheme = url.protocol.replace(/:$/, '')
  if (scheme !== 'wallet-toolbox') return unresolved('unsupported-signer-ref-scheme')

  const network = normalizeNetwork(url.hostname)
  if (network === null) return unresolved('signer-ref-invalid')
  if (expectedNetwork !== null && network !== expectedNetwork) return unresolved('signer-ref-network-mismatch')

  const ref = normalizeText(decodeURIComponent(url.pathname.replace(/^\/+/, '')))
  if (ref === null) return unresolved('signer-ref-invalid')
  if (isPlaceholderSignerRef(ref)) return unresolved('signer-ref-placeholder')
  if (isSecretLikeSignerRef(ref)) return unresolved('signer-ref-secret-like')

  return {
    ok: true,
    signerRefResolved: true,
    blocker: null,
    parsed: {
      scheme: 'wallet-toolbox',
      network,
      ref,
      walletStorageNamespace: walletStorageNamespace(network, ref)
    }
  }
}

export function normalizeWalletToolboxSignerRefNetwork (value: unknown): WalletToolboxSignerRefNetwork | null {
  return normalizeNetwork(value)
}

function unresolved (blocker: WalletToolboxSignerRefBlocker): ParseWalletToolboxSignerRefResult {
  return {
    ok: false,
    signerRefResolved: false,
    blocker,
    parsed: null
  }
}

function walletStorageNamespace (network: WalletToolboxSignerRefNetwork, ref: string): string {
  const readableRef = ref.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  const digest = createHash('sha256').update(`${network}:${ref}`).digest('hex').slice(0, 16)
  return `wallet-toolbox-rocksdb:${network}:${readableRef !== '' ? readableRef : 'wallet'}:${digest}`
}

function normalizeNetwork (value: unknown): WalletToolboxSignerRefNetwork | null {
  const normalized = normalizeText(value)?.toLowerCase()
  if (normalized === 'testnet' || normalized === 'test' || normalized === 'bsv-testnet') return 'bsv-testnet'
  if (normalized === 'mainnet' || normalized === 'main' || normalized === 'bsv-mainnet') return 'bsv-mainnet'
  return null
}

function isPlaceholderSignerRef (value: string): boolean {
  return /^(?:<.*>|REPLACE_WITH_|placeholder$|local-testnet-ref$|local-testnet-signing-reference$|local testnet signing reference)/i.test(value)
}

function isSecretLikeSignerRef (value: string): boolean {
  return /\b[xt]prv[A-Za-z0-9]{20,}\b/i.test(value) ||
    /\b(?:WIF|wif|privateKey|private_key|seed|mnemonic|rawSigningMaterial|raw_signing_material|secret)\b/i.test(value)
}

function normalizeText (value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized !== '' ? normalized : null
}
