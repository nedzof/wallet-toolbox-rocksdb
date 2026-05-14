import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction } from '@bsv/sdk'
import {
  getRocksDbWalletReceiveDestinationFromSignerRef,
  inspectRocksDbWalletFromSignerRef,
  ROCKSDB_WALLET_IDENTITY_KEY
} from '../SetupRocksDb'
import { RocksDbWalletStore } from '../storage/rocksdb'
import {
  normalizeWalletToolboxSignerRefNetwork,
  parseWalletToolboxSignerRef,
  type WalletToolboxSignerRefNetwork
} from './SignerRef'

export type RocksDbWalletProductionSigningBlocker =
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
  | 'wallet-toolbox-utxo-state-empty'
  | 'wallet-toolbox-insufficient-spendable-utxos'
  | 'wallet-toolbox-required-utxo-unavailable'
  | 'wallet-toolbox-required-utxo-outside-source-basket'
  | 'wallet-toolbox-source-basket-mismatch'
  | 'wallet-toolbox-reserved-outpoint-mismatch'
  | 'wallet-toolbox-recipient-output-invalid'
  | 'wallet-toolbox-idempotency-key-required'

export interface RocksDbWalletRecipientOutputIntent {
  satoshis: number
  script?: string | null
  address?: string | null
  to?: string | null
}

export interface RocksDbWalletSpendableUtxo {
  txid: string
  vout: number
  satoshis: number
  rawSourceTxHex: string
  status?: 'spendable' | 'reserved' | 'spent' | 'quarantined' | 'unknown'
  network?: WalletToolboxSignerRefNetwork
  signerRef?: string
  basketId?: string
}

export interface ImportRocksDbWalletUtxosArgs {
  walletPath: string
  signerRef: string
  network: WalletToolboxSignerRefNetwork | 'testnet' | 'mainnet'
  utxos: RocksDbWalletSpendableUtxo[]
  localKeyConfigPath?: string | null
  requireWalletOwnership?: boolean
  basketId?: string | null
}

export type SyncRocksDbWalletUtxosArgs = ImportRocksDbWalletUtxosArgs

export interface ListRocksDbWalletSpendableUtxosArgs {
  walletPath: string
  signerRef: string
  network: WalletToolboxSignerRefNetwork | 'testnet' | 'mainnet'
  basketId?: string | null
}

export interface RocksDbWalletSpendableUtxoSummary {
  outpoint: string
  txid: string
  vout: number
  satoshis: number
  network: WalletToolboxSignerRefNetwork
  signerRef: string
  status: 'spendable'
  walletStorageNamespace: string
  basketId: string | null
}

export interface SignRocksDbWalletPaymentArgs {
  signerRef: string
  walletPath: string
  localKeyConfigPath?: string | null
  recipientOutputs: RocksDbWalletRecipientOutputIntent[]
  idempotencyKey: string
  network: WalletToolboxSignerRefNetwork | 'testnet' | 'mainnet'
  satsPerKb?: number
  createdAt?: Date | string | number
  requiredOutpoints?: string[]
  sourceBasketId?: string | null
  changeBasketId?: string | null
}

export type DryRunRocksDbWalletPaymentArgs = SignRocksDbWalletPaymentArgs

export interface SignRocksDbWalletPaymentResult {
  ok: boolean
  status: 'signed' | 'blocked'
  txid: string | null
  rawTxHex: string | null
  rawTxHash: string | null
  inputCount: number
  outputCount: number
  spendSats: number
  feeSats: number
  selectedOutpoints: string[]
  requiredOutpoints: string[]
  signingRecordTxid: string | null
  signingRecordIdempotencyKey: string | null
  signingRecordSelectedOutpoints: string[]
  signingRecordRequiredOutpoints: string[]
  sourceBasketId: string | null
  changeBasketId: string | null
  signingRecordSourceBasketId: string | null
  signingRecordChangeBasketId: string | null
  replayed: boolean
  duplicateExternalEffects: 0
  unknownOutcome: false
  network: WalletToolboxSignerRefNetwork | null
  signerRefResolved: boolean
  walletStorageNamespace: string | null
  blocker: RocksDbWalletProductionSigningBlocker | null
}

export interface DryRunRocksDbWalletPaymentResult {
  ok: boolean
  status: 'ready' | 'blocked'
  txid: null
  rawTxHex: null
  rawTxHash: null
  inputCount: number
  outputCount: number
  spendSats: number
  feeSats: 0
  replayed: false
  duplicateExternalEffects: 0
  unknownOutcome: false
  network: WalletToolboxSignerRefNetwork | null
  signerRefResolved: boolean
  walletStorageNamespace: string | null
  blocker: RocksDbWalletProductionSigningBlocker | null
}

interface LocalKeyConfig {
  rootKeyHex?: string
  signers?: Record<string, { rootKeyHex?: string }>
  signerRefs?: Record<string, { rootKeyHex?: string }>
  wallets?: Record<string, { rootKeyHex?: string }>
}

interface SigningRecord {
  status: 'signed'
  txid: string
  rawTxHex: string
  rawTxHash: string
  inputOutpoints: string[]
  requiredOutpoints: string[]
  sourceBasketId: string | null
  changeBasketId: string | null
  outputCount: number
  spendSats: number
  feeSats: number
  network: WalletToolboxSignerRefNetwork
  signerRef: string
  createdAt: string
}

export async function importRocksDbWalletUtxos (args: ImportRocksDbWalletUtxosArgs): Promise<{ ok: true, imported: number, walletStorageNamespace: string }> {
  const network = normalizeWalletToolboxSignerRefNetwork(args.network)
  const parsed = parseWalletToolboxSignerRef({ signerRef: args.signerRef, expectedNetwork: network ?? undefined })
  if (!parsed.ok || parsed.parsed === null || network === null) {
    throw new Error(`ROCKSDB_WALLET_UTXO_IMPORT_${parsed.blocker ?? 'network-invalid'}`)
  }
  const inspection = await inspectRocksDbWalletFromSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: network,
    walletPath: args.walletPath
  })
  if (inspection.ok !== true) {
    throw new Error(`ROCKSDB_WALLET_UTXO_IMPORT_${inspection.blocker ?? 'wallet-not-ready'}`)
  }
  const walletReceiveScript = args.requireWalletOwnership === true
    ? await ownedReceiveScript({
      signerRef: args.signerRef,
      expectedNetwork: network,
      walletPath: args.walletPath,
      localKeyConfigPath: args.localKeyConfigPath
    })
    : null

  const store = await RocksDbWalletStore.open({ path: args.walletPath, namespace: parsed.parsed.walletStorageNamespace })
  try {
    for (const utxo of args.utxos) {
      const normalized = normalizeUtxo(utxo, parsed.parsed.network, args.signerRef, normalizeBasketId(args.basketId) ?? normalizeBasketId(utxo.basketId))
      verifyRawSourceTx(normalized, walletReceiveScript)
      await store.put({
        key: utxoKey(normalized),
        value: normalized
      })
    }
    return {
      ok: true,
      imported: args.utxos.length,
      walletStorageNamespace: parsed.parsed.walletStorageNamespace
    }
  } finally {
    store.close()
  }
}

/**
 * @deprecated Use importRocksDbWalletUtxos. This alias is retained for existing
 * consumers while UTXO import remains owned by wallet-toolbox-rocksdb.
 */
export async function syncRocksDbWalletUtxos (args: SyncRocksDbWalletUtxosArgs): Promise<{ ok: true, imported: number, walletStorageNamespace: string }> {
  return await importRocksDbWalletUtxos(args)
}

export async function listRocksDbWalletSpendableUtxosFromSignerRef (args: ListRocksDbWalletSpendableUtxosArgs): Promise<{
  ok: boolean
  spendableUtxos: RocksDbWalletSpendableUtxoSummary[]
  walletStorageNamespace: string | null
  network: WalletToolboxSignerRefNetwork | null
  blocker: RocksDbWalletProductionSigningBlocker | null
}> {
  const expectedNetwork = normalizeWalletToolboxSignerRefNetwork(args.network)
  const parsed = parseWalletToolboxSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: expectedNetwork ?? undefined
  })
  if (!parsed.ok || parsed.parsed === null) {
    return spendableUtxosBlocked(parsed.blocker, null, null)
  }
  const inspection = await inspectRocksDbWalletFromSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: expectedNetwork ?? undefined,
    walletPath: args.walletPath
  })
  if (inspection.ok !== true) {
    return spendableUtxosBlocked(inspection.blocker as RocksDbWalletProductionSigningBlocker, parsed.parsed.network, parsed.parsed.walletStorageNamespace)
  }

  const store = await RocksDbWalletStore.open({ path: args.walletPath, namespace: parsed.parsed.walletStorageNamespace })
  try {
    const basketId = normalizeBasketId(args.basketId)
    const spendableUtxos = (await store.scan<RocksDbWalletSpendableUtxo>({ prefix: 'utxo!available!', limit: 1000 }))
      .map(record => record.value)
      .filter(utxo => utxo.status === 'spendable' && utxo.network === parsed.parsed!.network && utxo.signerRef === args.signerRef)
      .filter(utxo => basketId == null || normalizeBasketId(utxo.basketId) === basketId)
      .map(utxo => ({
        outpoint: outpointId(utxo),
        txid: utxo.txid,
        vout: utxo.vout,
        satoshis: utxo.satoshis,
        network: parsed.parsed!.network,
        signerRef: args.signerRef,
        status: 'spendable' as const,
        walletStorageNamespace: parsed.parsed!.walletStorageNamespace,
        basketId: normalizeBasketId(utxo.basketId)
      }))
      .sort((left, right) => right.satoshis - left.satoshis || left.outpoint.localeCompare(right.outpoint))
    return {
      ok: true,
      spendableUtxos,
      walletStorageNamespace: parsed.parsed.walletStorageNamespace,
      network: parsed.parsed.network,
      blocker: null
    }
  } finally {
    store.close()
  }
}

export async function dryRunRocksDbWalletPayment (args: DryRunRocksDbWalletPaymentArgs): Promise<DryRunRocksDbWalletPaymentResult> {
  const expectedNetwork = normalizeWalletToolboxSignerRefNetwork(args.network)
  const parsed = parseWalletToolboxSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: expectedNetwork ?? undefined
  })
  if (!parsed.ok || parsed.parsed === null) return dryRunBlocked(parsed.blocker, null, false, null)

  const idempotencyKey = String(args.idempotencyKey ?? '').trim()
  if (idempotencyKey === '') return dryRunBlocked('wallet-toolbox-idempotency-key-required', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)

  const inspection = await inspectRocksDbWalletFromSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: expectedNetwork ?? undefined,
    walletPath: args.walletPath
  })
  if (inspection.ok !== true) {
    return dryRunBlocked(inspection.blocker as RocksDbWalletProductionSigningBlocker, parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
  }

  const rootKeyHex = await resolveRootKeyHex(args.localKeyConfigPath, args.signerRef, parsed.parsed.ref)
  if (rootKeyHex === null) {
    return dryRunBlocked(
      args.localKeyConfigPath == null ? 'wallet-toolbox-local-key-config-missing' : 'wallet-toolbox-local-key-missing',
      parsed.parsed.network,
      true,
      parsed.parsed.walletStorageNamespace
    )
  }

  const outputs = normalizeOutputs(args.recipientOutputs, { allowToOnly: true })
  if (outputs === null || outputs.length === 0) {
    return dryRunBlocked('wallet-toolbox-recipient-output-invalid', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
  }

  const store = await RocksDbWalletStore.open({ path: args.walletPath, namespace: parsed.parsed.walletStorageNamespace })
  try {
    const utxos = (await store.scan<RocksDbWalletSpendableUtxo>({ prefix: 'utxo!available!', limit: 1000 }))
      .map(record => record.value)
      .filter(utxo => utxo.status === 'spendable' && utxo.network === parsed.parsed!.network && utxo.signerRef === args.signerRef)
    if (utxos.length === 0) return dryRunBlocked('wallet-toolbox-utxo-state-empty', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
    return {
      ok: true,
      status: 'ready',
      txid: null,
      rawTxHex: null,
      rawTxHash: null,
      inputCount: utxos.length,
      outputCount: outputs.length,
      spendSats: outputs.reduce((sum, output) => sum + output.satoshis, 0),
      feeSats: 0,
      replayed: false,
      duplicateExternalEffects: 0,
      unknownOutcome: false,
      network: parsed.parsed.network,
      signerRefResolved: true,
      walletStorageNamespace: parsed.parsed.walletStorageNamespace,
      blocker: null
    }
  } finally {
    store.close()
  }
}

export async function signRocksDbWalletPayment (args: SignRocksDbWalletPaymentArgs): Promise<SignRocksDbWalletPaymentResult> {
  const expectedNetwork = normalizeWalletToolboxSignerRefNetwork(args.network)
  const parsed = parseWalletToolboxSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: expectedNetwork ?? undefined
  })
  if (!parsed.ok || parsed.parsed === null) return blocked(parsed.blocker, null, false, null)

  const idempotencyKey = String(args.idempotencyKey ?? '').trim()
  if (idempotencyKey === '') return blocked('wallet-toolbox-idempotency-key-required', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
  const requiredOutpoints = normalizeRequiredOutpoints(args.requiredOutpoints)
  const sourceBasketId = normalizeBasketId(args.sourceBasketId)
  const changeBasketId = normalizeBasketId(args.changeBasketId) ?? sourceBasketId

  const inspection = await inspectRocksDbWalletFromSignerRef({
    signerRef: args.signerRef,
    expectedNetwork: expectedNetwork ?? undefined,
    walletPath: args.walletPath
  })
  if (inspection.ok !== true) {
    return blocked(inspection.blocker as RocksDbWalletProductionSigningBlocker, parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
  }

  const store = await RocksDbWalletStore.open({ path: args.walletPath, namespace: parsed.parsed.walletStorageNamespace })
  try {
    const existing = await store.get<SigningRecord>(signingKey(idempotencyKey))
    if (existing?.value.status === 'signed') {
      const existingInputOutpoints = normalizeRequiredOutpoints(existing.value.inputOutpoints)
      const existingRequiredOutpoints = normalizeRequiredOutpoints(existing.value.requiredOutpoints)
      const existingSourceBasketId = normalizeBasketId(existing.value.sourceBasketId)
      const existingChangeBasketId = normalizeBasketId(existing.value.changeBasketId)
      if (sourceBasketId !== existingSourceBasketId) {
        return {
          ...blocked('wallet-toolbox-source-basket-mismatch', existing.value.network, true, parsed.parsed.walletStorageNamespace),
          signingRecordTxid: existing.value.txid,
          signingRecordIdempotencyKey: idempotencyKey,
          signingRecordSelectedOutpoints: existingInputOutpoints,
          signingRecordRequiredOutpoints: existingRequiredOutpoints,
          signingRecordSourceBasketId: existingSourceBasketId,
          signingRecordChangeBasketId: existingChangeBasketId
        }
      }
      if (requiredOutpoints.length > 0 && !sameOutpoints(existingRequiredOutpoints, requiredOutpoints)) {
        return {
          ...blocked('wallet-toolbox-reserved-outpoint-mismatch', existing.value.network, true, parsed.parsed.walletStorageNamespace),
          signingRecordTxid: existing.value.txid,
          signingRecordIdempotencyKey: idempotencyKey,
          signingRecordSelectedOutpoints: existingInputOutpoints,
          signingRecordRequiredOutpoints: existingRequiredOutpoints,
          signingRecordSourceBasketId: existingSourceBasketId,
          signingRecordChangeBasketId: existingChangeBasketId
        }
      }
      return {
        ok: true,
        status: 'signed',
        txid: existing.value.txid,
        rawTxHex: existing.value.rawTxHex,
        rawTxHash: existing.value.rawTxHash,
        inputCount: existing.value.inputOutpoints.length,
        outputCount: existing.value.outputCount,
        spendSats: existing.value.spendSats,
        feeSats: existing.value.feeSats,
        selectedOutpoints: existing.value.inputOutpoints,
        requiredOutpoints: existingRequiredOutpoints,
        signingRecordTxid: existing.value.txid,
        signingRecordIdempotencyKey: idempotencyKey,
        signingRecordSelectedOutpoints: existingInputOutpoints,
        signingRecordRequiredOutpoints: existingRequiredOutpoints,
        sourceBasketId: existingSourceBasketId,
        changeBasketId: existingChangeBasketId,
        signingRecordSourceBasketId: existingSourceBasketId,
        signingRecordChangeBasketId: existingChangeBasketId,
        replayed: true,
        duplicateExternalEffects: 0,
        unknownOutcome: false,
        network: existing.value.network,
        signerRefResolved: true,
        walletStorageNamespace: parsed.parsed.walletStorageNamespace,
        blocker: null
      }
    }

    const identity = await store.get(ROCKSDB_WALLET_IDENTITY_KEY)
    if (identity === undefined) {
      return blocked('wallet-toolbox-wallet-not-initialized', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
    }

    const rootKeyHex = await resolveRootKeyHex(args.localKeyConfigPath, args.signerRef, parsed.parsed.ref)
    if (rootKeyHex === null) {
      return blocked(
        args.localKeyConfigPath == null ? 'wallet-toolbox-local-key-config-missing' : 'wallet-toolbox-local-key-missing',
        parsed.parsed.network,
        true,
        parsed.parsed.walletStorageNamespace
      )
    }

    const outputs = normalizeOutputs(args.recipientOutputs)
    if (outputs === null || outputs.length === 0) {
      return blocked('wallet-toolbox-recipient-output-invalid', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
    }

    const availableUtxos = (await store.scan<RocksDbWalletSpendableUtxo>({ prefix: 'utxo!available!', limit: 1000 }))
      .map(record => record.value)
      .filter(utxo => utxo.status === 'spendable' && utxo.network === parsed.parsed!.network && utxo.signerRef === args.signerRef)
      .filter(utxo => sourceBasketId == null || normalizeBasketId(utxo.basketId) === sourceBasketId)
    if (availableUtxos.length === 0) return blocked('wallet-toolbox-utxo-state-empty', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)

    const utxos = requiredOutpoints.length > 0
      ? availableUtxos.filter(utxo => requiredOutpoints.includes(outpointId(utxo)))
      : availableUtxos
    if (requiredOutpoints.length > 0 && utxos.length !== requiredOutpoints.length) {
      return blocked(sourceBasketId == null ? 'wallet-toolbox-required-utxo-unavailable' : 'wallet-toolbox-required-utxo-outside-source-basket', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)
    }

    const signed = await buildSignedTransaction({
      rootKeyHex,
      utxos,
      outputs,
      network: parsed.parsed.network,
      satsPerKb: args.satsPerKb
    })
    if (signed === null) return blocked('wallet-toolbox-insufficient-spendable-utxos', parsed.parsed.network, true, parsed.parsed.walletStorageNamespace)

    const record: SigningRecord = {
      status: 'signed',
      txid: signed.txid,
      rawTxHex: signed.rawTxHex,
      rawTxHash: sha256(signed.rawTxHex),
      inputOutpoints: signed.inputOutpoints,
      requiredOutpoints,
      sourceBasketId,
      changeBasketId,
      outputCount: signed.outputCount,
      spendSats: signed.spendSats,
      feeSats: signed.feeSats,
      network: parsed.parsed.network,
      signerRef: args.signerRef,
      createdAt: normalizeDate(args.createdAt).toISOString()
    }
    await store.batch([
      { key: signingKey(idempotencyKey), value: record },
      ...signed.selectedUtxos.map(utxo => ({
        key: utxoKey(utxo),
        value: {
          ...utxo,
          status: 'reserved' as const,
          reservedBy: idempotencyKey,
          reservedTxid: signed.txid,
          reservedAt: record.createdAt
        }
      }))
    ])

    return {
      ok: true,
      status: 'signed',
      txid: record.txid,
      rawTxHex: record.rawTxHex,
      rawTxHash: record.rawTxHash,
      inputCount: record.inputOutpoints.length,
      outputCount: record.outputCount,
      spendSats: record.spendSats,
      feeSats: record.feeSats,
      selectedOutpoints: record.inputOutpoints,
      requiredOutpoints: record.requiredOutpoints,
      signingRecordTxid: record.txid,
      signingRecordIdempotencyKey: idempotencyKey,
      signingRecordSelectedOutpoints: record.inputOutpoints,
      signingRecordRequiredOutpoints: record.requiredOutpoints,
      sourceBasketId: record.sourceBasketId,
      changeBasketId: record.changeBasketId,
      signingRecordSourceBasketId: record.sourceBasketId,
      signingRecordChangeBasketId: record.changeBasketId,
      replayed: false,
      duplicateExternalEffects: 0,
      unknownOutcome: false,
      network: record.network,
      signerRefResolved: true,
      walletStorageNamespace: parsed.parsed.walletStorageNamespace,
      blocker: null
    }
  } finally {
    store.close()
  }
}

async function buildSignedTransaction (args: {
  rootKeyHex: string
  utxos: RocksDbWalletSpendableUtxo[]
  outputs: RocksDbWalletRecipientOutputIntent[]
  network: WalletToolboxSignerRefNetwork
  satsPerKb?: number
}): Promise<{
    txid: string
  rawTxHex: string
  inputOutpoints: string[]
  selectedUtxos: RocksDbWalletSpendableUtxo[]
  outputCount: number
  spendSats: number
  feeSats: number
  } | null> {
  const privateKey = PrivateKey.fromHex(args.rootKeyHex)
  const p2pkh = new P2PKH()
  const tx = new Transaction()
  const spendSats = args.outputs.reduce((sum, output) => sum + output.satoshis, 0)
  let inputSats = 0
  const selected: RocksDbWalletSpendableUtxo[] = []
  const spendable = [...args.utxos].sort((a, b) => b.satoshis - a.satoshis)
  const minimumFeeReserve = Math.max(1, Math.ceil((args.satsPerKb ?? 50) / 10))

  for (const utxo of spendable) {
    selected.push(utxo)
    inputSats += utxo.satoshis
    if (inputSats > spendSats + minimumFeeReserve) break
  }
  if (inputSats <= spendSats + minimumFeeReserve) return null

  for (const utxo of selected) {
    tx.addInput({
      sourceTransaction: Transaction.fromHex(utxo.rawSourceTxHex),
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: p2pkh.unlock(privateKey)
    })
  }
  for (const output of args.outputs) {
    tx.addOutput({
      lockingScript: output.script != null ? Script.fromHex(output.script) : p2pkh.lock(String(output.address)),
      satoshis: output.satoshis
    })
  }
  tx.addOutput({
    lockingScript: p2pkh.lock(privateKey.toAddress(args.network === 'bsv-mainnet' ? 'mainnet' : 'testnet')),
    satoshis: inputSats - spendSats,
    change: true
  })
  await tx.fee(new SatoshisPerKilobyte(Math.max(1, Math.trunc(args.satsPerKb ?? 50))))
  await tx.sign()

  return {
    txid: tx.id('hex'),
    rawTxHex: tx.toHex(),
    inputOutpoints: selected.map(outpointId),
    selectedUtxos: selected,
    outputCount: tx.outputs.length,
    spendSats,
    feeSats: tx.getFee()
  }
}

async function resolveRootKeyHex (localKeyConfigPath: string | null | undefined, signerRef: string, ref: string): Promise<string | null> {
  const filePath = String(localKeyConfigPath ?? '').trim()
  if (filePath === '') return null
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
  return candidates.map(value => String(value ?? '').trim()).find(value => /^[0-9a-f]{64}$/i.test(value)) ?? null
}

function normalizeOutputs (outputs: RocksDbWalletRecipientOutputIntent[], options: { allowToOnly?: boolean } = {}): RocksDbWalletRecipientOutputIntent[] | null {
  if (!Array.isArray(outputs)) return null
  const normalized: RocksDbWalletRecipientOutputIntent[] = []
  for (const output of outputs) {
    const satoshis = Math.trunc(Number(output?.satoshis ?? 0))
    const script = normalizeText(output?.script)
    const address = normalizeText(output?.address)
    const to = normalizeText(output?.to)
    if (satoshis <= 0 || (script == null && address == null && (options.allowToOnly !== true || to == null))) return null
    if (script != null && !/^[0-9a-f]+$/i.test(script)) return null
    normalized.push({ satoshis, script, address, to })
  }
  return normalized
}

function normalizeUtxo (utxo: RocksDbWalletSpendableUtxo, network: WalletToolboxSignerRefNetwork, signerRef: string, basketId: string | null): RocksDbWalletSpendableUtxo {
  const txid = normalizeText(utxo.txid)?.toLowerCase()
  const vout = Math.trunc(Number(utxo.vout))
  const satoshis = Math.trunc(Number(utxo.satoshis))
  const rawSourceTxHex = normalizeText(utxo.rawSourceTxHex)
  if (txid == null || !/^[0-9a-f]{64}$/.test(txid)) throw new Error('ROCKSDB_WALLET_UTXO_TXID_INVALID')
  if (!Number.isFinite(vout) || vout < 0) throw new Error('ROCKSDB_WALLET_UTXO_VOUT_INVALID')
  if (!Number.isFinite(satoshis) || satoshis <= 0) throw new Error('ROCKSDB_WALLET_UTXO_SATOSHIS_INVALID')
  if (rawSourceTxHex == null || !/^[0-9a-f]+$/i.test(rawSourceTxHex)) throw new Error('ROCKSDB_WALLET_UTXO_RAW_TX_INVALID')
  const status = utxo.status ?? 'spendable'
  if (status !== 'spendable') throw new Error(`ROCKSDB_WALLET_UTXO_STATUS_${String(status).toUpperCase()}_NOT_IMPORTABLE`)
  return {
    txid,
    vout,
    satoshis,
    rawSourceTxHex,
    status,
    network,
    signerRef,
    basketId: basketId ?? undefined
  }
}

async function ownedReceiveScript (args: {
  signerRef: string
  expectedNetwork: WalletToolboxSignerRefNetwork
  walletPath: string
  localKeyConfigPath?: string | null
}): Promise<string> {
  const destination = await getRocksDbWalletReceiveDestinationFromSignerRef(args)
  if (destination.ok !== true || destination.lockingScriptHex == null) {
    throw new Error(`ROCKSDB_WALLET_UTXO_IMPORT_${destination.blocker ?? 'wallet-toolbox-utxo-ownership-unverified'}`)
  }
  return destination.lockingScriptHex.toLowerCase()
}

function verifyRawSourceTx (utxo: RocksDbWalletSpendableUtxo, expectedLockingScriptHex: string | null): void {
  let sourceTx: Transaction
  try {
    sourceTx = Transaction.fromHex(utxo.rawSourceTxHex)
  } catch {
    throw new Error('ROCKSDB_WALLET_UTXO_RAW_TX_INVALID')
  }
  if (sourceTx.id('hex').toLowerCase() !== utxo.txid) throw new Error('ROCKSDB_WALLET_UTXO_RAW_TXID_MISMATCH')
  const output = sourceTx.outputs[utxo.vout]
  if (output == null) throw new Error('ROCKSDB_WALLET_UTXO_VOUT_MISSING')
  const satoshis = Number(output.satoshis)
  if (satoshis !== utxo.satoshis) throw new Error('ROCKSDB_WALLET_UTXO_SATOSHIS_MISMATCH')
  const lockingScriptHex = output.lockingScript.toHex().toLowerCase()
  if (expectedLockingScriptHex != null && lockingScriptHex !== expectedLockingScriptHex) {
    throw new Error('ROCKSDB_WALLET_UTXO_OWNERSHIP_UNVERIFIED')
  }
}

function utxoKey (utxo: RocksDbWalletSpendableUtxo): string {
  return `utxo!available!${utxo.txid}.${utxo.vout}`
}

function outpointId (utxo: Pick<RocksDbWalletSpendableUtxo, 'txid' | 'vout'>): string {
  return `${utxo.txid}:${utxo.vout}`
}

function normalizeRequiredOutpoints (value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(entry => {
    const normalized = String(entry ?? '').trim().toLowerCase().replace('.', ':')
    return /^[0-9a-f]{64}:\d+$/.test(normalized) ? normalized : null
  }).filter((entry): entry is string => entry != null))]
}

function normalizeBasketId (value: unknown): string | null {
  const normalized = normalizeText(value)
  if (normalized == null) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) return null
  return normalized
}

function sameOutpoints (left: string[], right: string[]): boolean {
  return JSON.stringify(normalizeRequiredOutpoints(left).sort()) === JSON.stringify(normalizeRequiredOutpoints(right).sort())
}

function signingKey (idempotencyKey: string): string {
  return `production-signing!${sha256(idempotencyKey)}`
}

function blocked (
  blocker: RocksDbWalletProductionSigningBlocker | null,
  network: WalletToolboxSignerRefNetwork | null,
  signerRefResolved: boolean,
  walletStorageNamespace: string | null
): SignRocksDbWalletPaymentResult {
  return {
    ok: false,
    status: 'blocked',
    txid: null,
    rawTxHex: null,
    rawTxHash: null,
    inputCount: 0,
    outputCount: 0,
    spendSats: 0,
    feeSats: 0,
    selectedOutpoints: [],
    requiredOutpoints: [],
    signingRecordTxid: null,
    signingRecordIdempotencyKey: null,
    signingRecordSelectedOutpoints: [],
    signingRecordRequiredOutpoints: [],
    sourceBasketId: null,
    changeBasketId: null,
    signingRecordSourceBasketId: null,
    signingRecordChangeBasketId: null,
    replayed: false,
    duplicateExternalEffects: 0,
    unknownOutcome: false,
    network,
    signerRefResolved,
    walletStorageNamespace,
    blocker
  }
}

function spendableUtxosBlocked (
  blocker: RocksDbWalletProductionSigningBlocker | null,
  network: WalletToolboxSignerRefNetwork | null,
  walletStorageNamespace: string | null
): {
    ok: false
    spendableUtxos: RocksDbWalletSpendableUtxoSummary[]
    walletStorageNamespace: string | null
    network: WalletToolboxSignerRefNetwork | null
    blocker: RocksDbWalletProductionSigningBlocker | null
  } {
  return {
    ok: false,
    spendableUtxos: [],
    walletStorageNamespace,
    network,
    blocker
  }
}

function dryRunBlocked (
  blocker: RocksDbWalletProductionSigningBlocker | null,
  network: WalletToolboxSignerRefNetwork | null,
  signerRefResolved: boolean,
  walletStorageNamespace: string | null
): DryRunRocksDbWalletPaymentResult {
  return {
    ok: false,
    status: 'blocked',
    txid: null,
    rawTxHex: null,
    rawTxHash: null,
    inputCount: 0,
    outputCount: 0,
    spendSats: 0,
    feeSats: 0,
    replayed: false,
    duplicateExternalEffects: 0,
    unknownOutcome: false,
    network,
    signerRefResolved,
    walletStorageNamespace,
    blocker
  }
}

function normalizeText (value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized !== '' ? normalized : null
}

function normalizeDate (value?: Date | string | number): Date {
  if (value === undefined) return new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return new Date()
  return date
}

function sha256 (value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
