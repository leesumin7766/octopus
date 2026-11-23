import { request, type IncomingMessage } from 'node:http'
import { createConnection } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { OAuthError, startLoopback, type LoopbackSession } from '../../src/main/platform/oauth/loopback'

// 진짜 127.0.0.1 서버를 띄우는 테스트. 바깥 네트워크로는 나가지 않는다(가짜 브라우저가 같은 PC 의 루프백으로만 요청한다).

interface Reply {
  status: number
  body: string
  headers: IncomingMessage['headers']
}

/** 가짜 브라우저: 루프백 서버에 GET 한 번 */
async function browse(port: number, pathAndQuery: string, headers: Record<string, string> = {}): Promise<Reply> {
  // 이 PC 의 네트워크 계층이 가끔 연결을 EFAULT 로 거절한다(테스트 환경의 문제). 몇 번 다시 시도한다.
  for (let attempt = 0; ; attempt++) {
    try {
      return await browseOnce(port, pathAndQuery, headers)
    } catch (error) {
      if (attempt >= 6 || (error as NodeJS.ErrnoException).code !== 'EFAULT') throw error
    }
  }
}

function browseOnce(port: number, pathAndQuery: string, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathAndQuery, method: 'GET', headers, agent: false }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** 포트가 열려 있는지. 환경이 연결을 EFAULT 로 거절한 경우는 답이 아니므로 다시 해 본다(연결 거부 ECONNREFUSED 만 "닫힘"). */
async function canConnect(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const answer = await new Promise<boolean | 'retry'>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED' ? false : 'retry'))
    })
    if (answer !== 'retry') return answer
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('could not tell whether the port is open')
}

/** 아직 결과가 나지 않았는지(대기 중인지) */
async function pending(session: LoopbackSession): Promise<boolean> {
  const marker = Symbol('pending')
  return (await Promise.race([session.result.then(() => 'done', () => 'done'), new Promise((r) => setTimeout(() => r(marker), 30))])) === marker
}

describe('loopback receiver (real 127.0.0.1 server)', () => {
  const open: LoopbackSession[] = []
  afterEach(() => {
    for (const s of open) s.cancel()
    open.length = 0
  })
  const start = async (opts: Parameters<typeof startLoopback>[0]): Promise<LoopbackSession> => {
    const s = await startLoopback(opts)
    open.push(s)
    return s
  }

  it('listens on a random free port of 127.0.0.1 and gives the matching redirect_uri', async () => {
    const a = await start({ state: 's1' })
    const b = await start({ state: 's2' })
    expect(a.port).toBeGreaterThan(0)
    expect(a.port).not.toBe(b.port)
    expect(a.redirectUri).toBe(`http://127.0.0.1:${a.port}/oauth/callback`)
  })

  it('delivers the code from the redirect, answers with a small page with no outside resources, and closes the port at once', async () => {
    const s = await start({ state: 'good-state' })

    const reply = await browse(s.port, '/oauth/callback?code=THE-CODE&state=good-state')

    expect(await s.result).toEqual({ code: 'THE-CODE' })
    expect(reply.status).toBe(200)
    expect(reply.body).toContain('Octopus 로 돌아가세요')
    expect(reply.body).not.toMatch(/https?:\/\/|<script|<link|<img|src=/i)
    expect(reply.headers['content-security-policy']).toContain("default-src 'none'")
    expect(reply.headers['cache-control']).toBe('no-store')
    await new Promise((r) => setTimeout(r, 50))
    expect(await canConnect(s.port)).toBe(false) // 서버가 닫혔다
  })

  it('ignores a wrong path, a wrong state, a missing code and a non-GET, and keeps waiting for the real redirect', async () => {
    const s = await start({ state: 'good-state' })

    expect((await browse(s.port, '/other?code=EVIL&state=good-state')).status).toBe(404)
    expect((await browse(s.port, '/oauth/callback?code=EVIL&state=wrong')).status).toBe(400)
    expect((await browse(s.port, '/oauth/callback?code=EVIL')).status).toBe(400) // state 없음
    expect((await browse(s.port, '/oauth/callback?state=good-state')).status).toBe(400) // code 없음
    expect(await pending(s)).toBe(true)
    expect(await canConnect(s.port)).toBe(true)

    await browse(s.port, '/oauth/callback?code=REAL&state=good-state')
    expect(await s.result).toEqual({ code: 'REAL' })
  })

  it('refuses a request whose Host is not 127.0.0.1:<port> (e.g. a DNS-rebinding name) and keeps waiting', async () => {
    const s = await start({ state: 'st' })

    const reply = await browse(s.port, '/oauth/callback?code=EVIL&state=st', { host: 'evil.example.com' })
    const localhost = await browse(s.port, '/oauth/callback?code=EVIL&state=st', { host: `localhost:${s.port}` })

    expect(reply.status).toBe(400)
    expect(localhost.status).toBe(400)
    expect(await pending(s)).toBe(true)
  })

  it('an error parameter with the right state rejects as "denied" and closes the port', async () => {
    const s = await start({ state: 'st' })

    const reply = await browse(s.port, '/oauth/callback?error=access_denied&state=st')

    await expect(s.result).rejects.toMatchObject({ kind: 'denied' })
    expect(reply.body).toContain('연결하지 않았어요')
    await new Promise((r) => setTimeout(r, 50))
    expect(await canConnect(s.port)).toBe(false)
  })

  it('an error parameter with the WRONG state is just ignored (it cannot cancel someone else\'s login)', async () => {
    const s = await start({ state: 'st' })
    expect((await browse(s.port, '/oauth/callback?error=access_denied&state=other')).status).toBe(400)
    expect(await pending(s)).toBe(true)
  })

  it('times out (default is 5 minutes; here a short one) with kind "timeout" and the port closes', async () => {
    const s = await start({ state: 'st', timeoutMs: 40 })

    await expect(s.result).rejects.toMatchObject({ kind: 'timeout' })

    expect(await canConnect(s.port)).toBe(false)
  })

  it('can be cancelled with a signal, or with cancel(); the port closes; a late redirect gets nothing', async () => {
    const controller = new AbortController()
    const a = await start({ state: 'st', signal: controller.signal })
    controller.abort()
    await expect(a.result).rejects.toMatchObject({ kind: 'cancelled' })
    expect(await canConnect(a.port)).toBe(false)

    const b = await start({ state: 'st' })
    b.cancel()
    await expect(b.result).rejects.toBeInstanceOf(OAuthError)
    expect(await canConnect(b.port)).toBe(false)

    const already = new AbortController()
    already.abort()
    const c = await start({ state: 'st', signal: already.signal })
    await expect(c.result).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('only the first valid redirect counts', async () => {
    const s = await start({ state: 'st' })
    await browse(s.port, '/oauth/callback?code=FIRST&state=st')
    await browse(s.port, '/oauth/callback?code=SECOND&state=st').catch(() => undefined) // 이미 닫혀 있을 수 있다
    expect(await s.result).toEqual({ code: 'FIRST' })
  })
})
