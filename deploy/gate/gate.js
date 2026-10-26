// Password gate for the game site. nginx asks /check whether a visitor has a
// valid session cookie; /login turns the right password into that cookie.
// Runs on localhost only, behind nginx.
//
// Env: GATE_SECRET (cookie signing key), GATE_PASSWORD_HASH ("scrypt:<saltHex>:<hashHex>")

import http from 'node:http'
import crypto from 'node:crypto'

const PORT = Number(process.env.GATE_PORT ?? 8790)
const HOST = '127.0.0.1'
const SECRET = process.env.GATE_SECRET
const PASS_HASH = process.env.GATE_PASSWORD_HASH
const COOKIE = 'city_session'
const SESSION_SECONDS = 12 * 3600

if (!SECRET || !PASS_HASH) {
  console.error('GATE_SECRET and GATE_PASSWORD_HASH must be set')
  process.exit(1)
}

const mac = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url')

function makeSession() {
  const body = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS)
  return `${body}.${mac(body)}`
}

function hasValidSession(cookieHeader = '') {
  const part = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))
  if (!part) return false
  const [body, sig] = part.slice(COOKIE.length + 1).split('.')
  if (!body || !sig) return false
  const expected = Buffer.from(mac(body))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false
  return Number(body) > Math.floor(Date.now() / 1000)
}

function passwordMatches(password) {
  const [, saltHex, hashHex] = PASS_HASH.split(':')
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
  const want = Buffer.from(hashHex, 'hex')
  return hash.length === want.length && crypto.timingSafeEqual(hash, want)
}

function readBody(req, limit = 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/check') {
    res.writeHead(hasValidSession(req.headers.cookie) ? 204 : 401)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/login') {
    let password = ''
    try {
      password = new URLSearchParams(await readBody(req)).get('password') ?? ''
    } catch {
      res.writeHead(413)
      res.end()
      return
    }
    if (password.length > 0 && passwordMatches(password)) {
      res.writeHead(303, {
        Location: '/',
        'Set-Cookie': `${COOKIE}=${makeSession()}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
      })
      res.end()
      return
    }
    res.writeHead(303, { Location: '/gate/?error=1' })
    res.end()
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, HOST, () => {
  console.log(`gate on ${HOST}:${PORT}`)
})
