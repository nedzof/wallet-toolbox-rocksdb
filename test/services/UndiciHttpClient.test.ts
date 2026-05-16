import http from 'http'
import { AddressInfo } from 'net'
import { UndiciHttpClient } from '../../src/http/UndiciHttpClient'

describe('UndiciHttpClient', () => {
  let server: http.Server
  let baseUrl: string

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/echo') {
        const chunks: Buffer[] = []
        req.on('data', chunk => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            contentType: req.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8')
          }))
        })
        return
      }
      if (req.url === '/json') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, method: req.method }))
        return
      }
      if (req.url === '/binary') {
        res.setHeader('Content-Type', 'application/octet-stream')
        res.end(Buffer.from([1, 2, 3, 4]))
        return
      }
      res.setHeader('Content-Type', 'text/plain')
      res.end('plain')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error == null ? resolve() : reject(error))
    })
  })

  test('adapts undici responses to the SDK HttpClient shape', async () => {
    const client = new UndiciHttpClient({ connections: 2, pipelining: 2 })
    try {
      const json = await client.request<{ ok: boolean, method: string }>(`${baseUrl}/json`, { method: 'POST', data: { a: 1 } })
      const text = await client.request<string>(`${baseUrl}/text`, { method: 'GET' })
      const echoText = await client.request<{ body: string }>(`${baseUrl}/echo`, { method: 'POST', data: 'raw-body' })
      const echoBytes = await client.request<{ body: string }>(`${baseUrl}/echo`, { method: 'POST', data: Buffer.from('byte-body') })
      const bytes = await client.download(`${baseUrl}/binary`)

      expect(json.ok).toBe(true)
      expect(json.status).toBe(200)
      expect(json.data).toEqual({ ok: true, method: 'POST' })
      expect(text.data).toBe('plain')
      expect(echoText.data.body).toBe('raw-body')
      expect(echoBytes.data.body).toBe('byte-body')
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4])
    } finally {
      await client.close()
    }
  })

  test('defaults to the target pooled HTTP settings with HTTP/2 negotiation enabled', () => {
    const client = new UndiciHttpClient()

    expect((client as any).connections).toBe(50)
    expect((client as any).pipelining).toBe(10)
    expect((client as any).allowH2).toBe(true)

    const http1Only = new UndiciHttpClient({ connections: 2, pipelining: 1, allowH2: false })
    expect((http1Only as any).connections).toBe(2)
    expect((http1Only as any).pipelining).toBe(1)
    expect((http1Only as any).allowH2).toBe(false)
  })

  test('reuses one undici Pool per origin and clears pools on close', async () => {
    const client = new UndiciHttpClient({ connections: 1, pipelining: 1 })
    const pools = (client as any).pools as Map<string, unknown>

    expect(pools.size).toBe(0)
    try {
      await client.request(`${baseUrl}/json`, { method: 'GET' })
      expect(pools.size).toBe(1)
      const firstPool = pools.get(baseUrl)

      await client.request(`${baseUrl}/text`, { method: 'GET' })

      expect(pools.size).toBe(1)
      expect(pools.get(baseUrl)).toBe(firstPool)
    } finally {
      await client.close()
    }
    expect(pools.size).toBe(0)
  })
})
