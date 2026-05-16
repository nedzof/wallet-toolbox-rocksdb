import { Wallet } from '../../../src/Wallet'

describe('Wallet destroy lifecycle', () => {
  test('destroys monitor and services before storage', async () => {
    const calls: string[] = []
    const wallet = Object.create(Wallet.prototype) as Wallet
    ;(wallet as any).monitor = {
      destroy: jest.fn(async () => { calls.push('monitor') })
    }
    ;(wallet as any).services = {
      close: jest.fn(async () => { calls.push('services') })
    }
    ;(wallet as any).storage = {
      destroy: jest.fn(async () => { calls.push('storage') })
    }
    ;(wallet as any).privilegedKeyManager = {
      destroyKey: jest.fn(() => { calls.push('privileged') })
    }

    await wallet.destroy()

    expect(calls).toEqual(['monitor', 'services', 'storage', 'privileged'])
    expect(wallet.monitor!.destroy).toHaveBeenCalledTimes(1)
    expect(wallet.services!.close).toHaveBeenCalledTimes(1)
    expect(wallet.storage.destroy).toHaveBeenCalledTimes(1)
    expect(wallet.privilegedKeyManager!.destroyKey).toHaveBeenCalledTimes(1)
  })
})
