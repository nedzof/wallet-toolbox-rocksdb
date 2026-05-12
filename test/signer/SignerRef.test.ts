import {
  resolveRocksDbWalletSignerRef
} from '../../src/signer/WalletToolboxSignerRefResolver'
import { parseWalletToolboxSignerRef } from '../../src/signer/SignerRef'

describe('wallet-toolbox signerRef resolver', () => {
  test('parses wallet-toolbox testnet autonomous-commerce refs', () => {
    const parsed = parseWalletToolboxSignerRef({
      signerRef: 'wallet-toolbox://testnet/autonomous-commerce',
      expectedNetwork: 'bsv-testnet'
    })

    expect(parsed).toMatchObject({
      ok: true,
      signerRefResolved: true,
      blocker: null,
      parsed: {
        scheme: 'wallet-toolbox',
        network: 'bsv-testnet',
        ref: 'autonomous-commerce'
      }
    })
    expect(parsed.parsed?.walletStorageNamespace).toMatch(/^wallet-toolbox-rocksdb:bsv-testnet:autonomous-commerce:[0-9a-f]{16}$/)
  })

  test('rejects mainnet refs when testnet is requested', () => {
    expect(resolveRocksDbWalletSignerRef({
      signerRef: 'wallet-toolbox://mainnet/autonomous-commerce',
      expectedNetwork: 'bsv-testnet'
    })).toMatchObject({
      ok: false,
      signerRefResolved: false,
      blocker: 'signer-ref-network-mismatch'
    })
  })

  test('rejects placeholders and secret-like refs', () => {
    expect(resolveRocksDbWalletSignerRef({
      signerRef: 'wallet-toolbox://testnet/REPLACE_WITH_LOCAL_SIGNER_REF',
      expectedNetwork: 'bsv-testnet'
    })).toMatchObject({
      ok: false,
      blocker: 'signer-ref-placeholder'
    })

    expect(resolveRocksDbWalletSignerRef({
      signerRef: 'wallet-toolbox://testnet/secret-reference',
      expectedNetwork: 'bsv-testnet'
    })).toMatchObject({
      ok: false,
      blocker: 'signer-ref-secret-like'
    })
  })

  test('resolves dry-run namespace and reports wallet initialization blocker', () => {
    const resolution = resolveRocksDbWalletSignerRef({
      signerRef: 'wallet-toolbox://testnet/autonomous-commerce',
      expectedNetwork: 'bsv-testnet'
    })

    expect(resolution).toMatchObject({
      ok: true,
      signerRefResolved: true,
      network: 'bsv-testnet',
      ref: 'autonomous-commerce',
      secretMaterialRequired: false,
      readyForDryRun: true,
      walletInitialized: false,
      blocker: 'wallet-storage-not-initialized'
    })
    expect(resolution.walletStorageNamespace).toMatch(/^wallet-toolbox-rocksdb:bsv-testnet:autonomous-commerce:[0-9a-f]{16}$/)
  })
})
