import { ARC } from '../../src/services/providers/ARC'
import { Bitails } from '../../src/services/providers/Bitails'
import SdkWhatsOnChain from '../../src/services/providers/SdkWhatsOnChain'
import { WhatsOnChain } from '../../src/services/providers/WhatsOnChain'
import { UndiciHttpClient } from '../../src/http/UndiciHttpClient'
import { Services } from '../../src/services/Services'

describe('provider HTTP client defaults', () => {
  test('ARC, WhatsOnChain, and Bitails default to the pooled undici adapter', () => {
    expect((new ARC('https://arc.example.test') as any).httpClient).toBeInstanceOf(UndiciHttpClient)
    expect((new ARC('https://arc.example.test', 'api-key') as any).httpClient).toBeInstanceOf(UndiciHttpClient)
    expect((new Bitails('test') as any).httpClient).toBeInstanceOf(UndiciHttpClient)
    expect((new SdkWhatsOnChain('test') as any).httpClient).toBeInstanceOf(UndiciHttpClient)
    expect((new WhatsOnChain('test', {}, {} as any) as any).httpClient).toBeInstanceOf(UndiciHttpClient)
  })

  test('provider constructors preserve explicitly injected HTTP clients', () => {
    const customHttpClient = {
      request: jest.fn()
    }

    expect((new ARC('https://arc.example.test', { httpClient: customHttpClient as any }) as any).httpClient).toBe(customHttpClient)
    expect((new Bitails('test', { httpClient: customHttpClient as any }) as any).httpClient).toBe(customHttpClient)
    expect((new SdkWhatsOnChain('test', { httpClient: customHttpClient as any }) as any).httpClient).toBe(customHttpClient)
    expect((new WhatsOnChain('test', { httpClient: customHttpClient as any }, {} as any) as any).httpClient).toBe(customHttpClient)
  })

  test('Services normalizes missing manual httpClient to a shared pooled adapter', () => {
    const options = Services.createDefaultOptions('test')
    delete options.httpClient
    delete options.arcConfig.httpClient
    delete options.arcGorillaPoolConfig!.httpClient

    const services = new Services(options)

    expect(services.options.httpClient).toBeInstanceOf(UndiciHttpClient)
    expect((services.whatsonchain as any).httpClient).toBe(services.options.httpClient)
    expect((services.arcTaal as any).httpClient).toBe(services.options.httpClient)
    expect((services.bitails as any).httpClient).toBe(services.options.httpClient)
  })

  test('Services closes only HTTP clients it owns', async () => {
    const defaultOptionsServices = new Services(Services.createDefaultOptions('test'))
    const defaultOptionsClose = jest.spyOn(defaultOptionsServices.options.httpClient as any, 'close').mockResolvedValue(undefined)

    await defaultOptionsServices.close()

    expect(defaultOptionsClose).toHaveBeenCalledTimes(1)

    const ownedOptions = Services.createDefaultOptions('test')
    delete ownedOptions.httpClient
    delete ownedOptions.arcConfig.httpClient
    delete ownedOptions.arcGorillaPoolConfig!.httpClient

    const ownedServices = new Services(ownedOptions)
    const ownedClose = jest.spyOn(ownedServices.options.httpClient as any, 'close').mockResolvedValue(undefined)

    await ownedServices.close()

    expect(ownedClose).toHaveBeenCalledTimes(1)

    const injectedHttpClient = {
      request: jest.fn(),
      close: jest.fn()
    }
    const injectedOptions = Services.createDefaultOptions('test')
    injectedOptions.httpClient = injectedHttpClient as any
    injectedOptions.arcConfig.httpClient = injectedHttpClient as any
    injectedOptions.arcGorillaPoolConfig!.httpClient = injectedHttpClient as any

    const injectedServices = new Services(injectedOptions)

    await injectedServices.close()

    expect(injectedHttpClient.close).not.toHaveBeenCalled()
  })
})
