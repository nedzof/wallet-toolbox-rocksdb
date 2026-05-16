import { AdminServer } from '../../../src/storage/adminServer/adminServer'
import { Services } from '../../../src/services/Services'

describe('AdminServer metrics endpoint', () => {
  test('serves Prometheus metrics before admin auth middleware', async () => {
    const services = new Services('test')
    services.metrics.setUtxoCacheSize(3)
    services.metrics.recordUtxoCacheRequest('hit', 3)
    services.metrics.recordUtxoCacheRequest('miss', 3)
    const server = new AdminServer({
      config: {
        chain: 'test',
        adminHost: '127.0.0.1',
        adminPort: 0,
        adminIdentityKeys: []
      },
      daemon: {
        setup: { services }
      } as any
    })

    server.start()
    try {
      services.metrics.recordBlockHeaderCacheRequest('hit', 2)
      services.metrics.recordBlockHeaderCacheRequest('miss', 2)
      await new Promise<void>(resolve => (server as any).server.on('listening', resolve))
      const address = (server as any).server.address()
      const response = await fetch(`http://127.0.0.1:${address.port}/metrics`)
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/plain')
      expect(body).toContain('wallet_toolbox_utxo_cache_entries 3')
      expect(body).toContain('wallet_toolbox_utxo_cache_hit_rate 0.5')
      expect(body).toContain('wallet_toolbox_block_header_cache_requests_total{result="hit"} 1')
      expect(body).toContain('wallet_toolbox_block_header_cache_requests_total{result="miss"} 1')
      expect(body).toContain('wallet_toolbox_block_header_cache_entries 2')
      expect(body).toContain('wallet_toolbox_block_header_cache_hit_rate 0.5')
    } finally {
      await server.close()
    }
  })
})
