import {
  resolveRocksDbWalletSignerRef
} from '../../src/signer/WalletToolboxSignerRefResolver'
import { parseWalletToolboxSignerRef } from '../../src/signer/SignerRef'

describe('wallet-toolbox signerRef resolver', () => {
  test('parses wallet-toolbox testnet demo-wallet refs', () => {
    const parsed = parseWalletToolboxSignerRef({
      signerRef: 'wallet-toolbox://testnet/demo-wallet',
      expectedNetwork: 'bsv-testnet'
    })

    expect(parsed).toMatchObject({
      ok: true,
      signerRefResolved: true,
      blocker: null,
      parsed: {
        scheme: 'wallet-toolbox',
        network: 'bsv-testnet',
        ref: 'demo-wallet'
      }
    })
    expect(parsed.parsed?.walletStorageNamespace).toMatch(/^wallet-toolbox-rocksdb:bsv-testnet:demo-wallet:[0-9a-f]{16}$/)
  })

  test('rejects mainnet refs when testnet is requested', () => {
    expect(resolveRocksDbWalletSignerRef({
      signerRef: 'wallet-toolbox://mainnet/demo-wallet',
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
      signerRef: 'wallet-toolbox://testnet/demo-wallet',
      expectedNetwork: 'bsv-testnet'
    })

    expect(resolution).toMatchObject({
      ok: true,
      signerRefResolved: true,
      network: 'bsv-testnet',
      ref: 'demo-wallet',
      secretMaterialRequired: false,
      readyForDryRun: true,
      walletInitialized: false,
      blocker: 'wallet-toolbox-wallet-not-initialized'
    })
    expect(resolution.walletStorageNamespace).toMatch(/^wallet-toolbox-rocksdb:bsv-testnet:demo-wallet:[0-9a-f]{16}$/)
  })

})
