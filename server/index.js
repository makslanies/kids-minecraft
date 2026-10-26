// Authoritative game server: raw WebSocket + JSON, one runtime dependency (ws).
//
//   node server/index.js            # PORT=8787 by default
//   PORT=9000 GAME_DATA_DIR=/tmp/x node server/index.js
//
// Exported `startServer` so tests can drive it in-process on an ephemeral port.

import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

import {
  SERVER_PORT, DEFAULT_SEED, INTEREST_RADIUS, SAVE_INTERVAL_MS, MAX_PAYLOAD,
  HELLO_TIMEOUT_MS, TICK_HZ, SNAPSHOT_HZ, INPUT_HZ, CHUNK_SIZE, MAX_PLAYERS,
  WORLD_X, WORLD_Y, WORLD_Z,
} from '../shared/constants.js'
import { B, BLOCKS } from '../shared/blocks.js'
import { C2S, ERR, tryDecode, serverMsg } from '../shared/protocol.js'
import { AuthoritativeWorld } from './world.js'
import { PlayerRegistry } from './players.js'
import { Persistence } from './persistence.js'
import { MobRegistry } from './mobs.js'
import { CityState } from './city.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function numEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function makeLogger(quiet) {
  if (quiet) return () => {}
  return (msg) => {
    const d = new Date()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    console.log(`[${hh}:${mm}:${ss}] ${msg}`)
  }
}

const publicPlayer = (p) => ({
  id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
})

const publicMob = (m) => ({
  id: m.id, kind: m.kind, x: m.pos.x, y: m.pos.y, z: m.pos.z, yaw: m.yaw, moving: m.moving,
})

export function startServer(options = {}) {
  const port = options.port ?? numEnv('PORT', SERVER_PORT)
  const host = options.host ?? process.env.HOST ?? '0.0.0.0'
  const dataDir = options.dataDir ?? process.env.GAME_DATA_DIR ?? path.join(HERE, 'data')
  const seed = options.seed ?? numEnv('SEED', DEFAULT_SEED)
  const interestRadius = options.interestRadius ?? numEnv('INTEREST_RADIUS', INTEREST_RADIUS)
  const saveIntervalMs = options.saveIntervalMs ?? numEnv('SAVE_INTERVAL_MS', SAVE_INTERVAL_MS)
  const log = options.log ?? makeLogger(options.quiet)

  const world = new AuthoritativeWorld({ seed })
  const city = new CityState({ world })
  const persistence = new Persistence({ world, city, dataDir, intervalMs: saveIntervalMs, log })
  persistence.load()
  // the letter cube may have been lost in a crash; put back the one the mission needs
  const letterHunt = options.letterHunt ?? true
  if (letterHunt) city.ensureCube()
  const players = new PlayerRegistry({ world, interestRadius, log })
  const mobs = new MobRegistry({ world, log })

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`voxel server\nseed=${world.seed}\nplayers=${players.size}/${MAX_PLAYERS}\nedits=${world.edits.size}\n`)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found\n')
  })

  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD })
  const send = (socket, raw) => {
    if (socket && socket.readyState === 1) socket.send(raw)
  }
  const fail = (socket, code) => send(socket, serverMsg.error(code))

  // ---------------------------------------------------------------- handlers

  function handleHello(socket, msg) {
    const existing = players.forSocket(socket)
    if (existing) {
      const offender = players.noteBadMessage(socket)
      fail(socket, ERR.BAD_MESSAGE)
      if (offender) socket.close(1008, 'duplicate hello')
      return
    }

    const result = players.add({ socket, name: msg.name, resumeToken: msg.resumeToken })
    if (!result.ok) {
      fail(socket, result.code)
      socket.close(1008, result.code)
      return
    }

    const me = result.player
    clearTimeout(socket._helloTimer)

    send(socket, serverMsg.init({
      selfId: me.id,
      resumeToken: me.resumeToken,
      name: me.name,
      seed: world.seed,
      world: { x: WORLD_X, y: WORLD_Y, z: WORLD_Z, chunk: CHUNK_SIZE },
      players: players.all().map(publicPlayer),
      scores: scoreboard(),
      mobs: mobs.visibleFrom(me.x, me.z, players.interestRadius * 2).map(publicMob),
      edits: world.editList(),
      city: city.status(),
      palette: BLOCKS.map((b) => ({ id: b.id, name: b.name })),
      rates: { input: INPUT_HZ, snapshot: SNAPSHOT_HZ, interestRadius: players.interestRadius },
      serverTime: Date.now(),
    }))

    // Others dropped our entity when we disconnected, so always re-announce.
    players.broadcastAll(serverMsg.playerJoin(publicPlayer(me)), me.id)
    players.broadcastAll(serverMsg.scores({ scores: scoreboard() }))
    log(`join  #${me.id} ${me.name} (${players.size} online${result.resumed ? ', resumed' : ''})`)
  }

  function handleInput(socket, msg) {
    const me = players.forSocket(socket)
    if (!me) return fail(socket, ERR.NOT_HELLOED)

    // Cheap flood guard: far above the 20 Hz the protocol asks for.
    const now = Date.now()
    socket._inputCount = (socket._inputCount || 0) + 1
    if (now - (socket._inputWindow || 0) > 1000) {
      socket._inputWindow = now
      socket._inputCount = 1
    }
    if (socket._inputCount > 60) return

    const res = players.applyInput(me, msg, now)
    if (res.ok) return
    fail(socket, ERR.SPEED)
    send(socket, serverMsg.correction(res.correction))
    if (res.kick) {
      log(`kick  #${me.id} ${me.name}: repeated movement violations`)
      socket.close(1008, 'speed')
    }
  }

  function handleBlockEdit(socket, msg) {
    const me = players.forSocket(socket)
    if (!me) return fail(socket, ERR.NOT_HELLOED)

    const now = Date.now()
    if (!players.editAllowed(me, now)) return fail(socket, ERR.RATE_LIMITED)

    // instant break, paced by the tool: check against the block that is
    // actually there, since that is what the player is looking at
    const target = world.get(msg.x, msg.y, msg.z)
    if (!players.breakAllowed(me, target, msg.tool || 0, now)) return

    const res = world.applyEdit(msg)
    if (!res.ok) {
      if (res.code === ERR.CONFLICT) {
        // Somebody else won the race. Tell the loser the truth so both sides
        // converge on the server's value in the same frame.
        send(socket, serverMsg.editRejected({
          seq: msg.seq, x: msg.x, y: msg.y, z: msg.z, actual: res.actual, reason: ERR.CONFLICT,
        }))
      } else {
        fail(socket, res.code)
      }
      return
    }

    players.recordEdit(me, now)
    players.broadcastAll(serverMsg.blockChanged({
      x: msg.x, y: msg.y, z: msg.z, block: res.block, by: me.id, seq: msg.seq,
    }))

    if (target === B.LETTER) {
      const found = city.letterBroken(msg.x, msg.y, msg.z)
      if (found) {
        me.score += found.points
        broadcastCubeChanges(found.changes)
        players.broadcastAll(serverMsg.city({
          error: null,
          newlyCompleted: found.newlyCompleted,
          reward: { letter: found.letter, points: found.points, by: me.name },
          ...city.status(),
        }))
        players.broadcastAll(serverMsg.scores({ scores: scoreboard() }))
        log(`letter ${found.letter} broken by ${me.name}, +${found.points}`)
      }
    }
  }

  /** Everyone's points, for the table every player sees. */
  function scoreboard() {
    return players.all().map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score }))
  }

  /** Tell everyone about blocks the server placed or removed by itself. */
  function broadcastCubeChanges(changes) {
    for (const c of changes) {
      players.broadcastAll(serverMsg.blockChanged({ x: c.x, y: c.y, z: c.z, block: c.block, by: 0, seq: 0 }))
    }
  }

  /**
   * "Проверить город". Every player gets the answer, because the city and its
   * missions are shared. A quick double press is ignored.
   */
  function handleCheck(socket) {
    const me = players.forSocket(socket)
    if (!me) return fail(socket, ERR.NOT_HELLOED)

    const now = Date.now()
    if (now - (me.lastCheckAt || 0) < 1000) return
    me.lastCheckAt = now

    const res = city.check()
    if (!res.ok) return send(socket, serverMsg.city({ error: res.error, ...res.status }))
    players.broadcastAll(serverMsg.city({ error: null, newlyCompleted: res.newlyCompleted, ...res.status }))
    if (res.newlyCompleted.length) log(`mission ${res.newlyCompleted.join(', ')} completed by ${me.name}`)
  }

  function onMessage(socket, raw) {
    const decoded = tryDecode(raw.toString())
    if (!decoded.ok) {
      const offender = players.noteBadMessage(socket)
      fail(socket, ERR.BAD_MESSAGE)
      if (offender) {
        log(`kick  #${offender.id} ${offender.name}: ${decoded.reason} messages`)
        socket.close(1008, 'bad messages')
      }
      return
    }
    const msg = decoded.msg
    switch (msg.type) {
      case C2S.HELLO: return handleHello(socket, msg)
      case C2S.INPUT: return handleInput(socket, msg)
      case C2S.BLOCK_EDIT: return handleBlockEdit(socket, msg)
      case C2S.CHECK: return handleCheck(socket)
      case C2S.PING: return send(socket, serverMsg.pong({ t: msg.t, serverTime: Date.now() }))
      default: return fail(socket, ERR.BAD_MESSAGE)
    }
  }

  wss.on('connection', (socket) => {
    socket._helloTimer = setTimeout(() => {
      if (!players.forSocket(socket)) {
        fail(socket, ERR.NOT_HELLOED)
        socket.close(1008, 'hello timeout')
      }
    }, HELLO_TIMEOUT_MS)

    socket.on('message', (raw) => {
      try {
        onMessage(socket, raw)
      } catch (err) {
        log(`error while handling a message: ${err.stack || err}`)
        fail(socket, ERR.BAD_MESSAGE)
      }
    })
    socket.on('close', () => {
      clearTimeout(socket._helloTimer)
      const me = players.forSocket(socket)
      if (!me) return
      players.remove(me)
      players.broadcastAll(serverMsg.playerLeave({ id: me.id }))
      players.broadcastAll(serverMsg.scores({ scores: scoreboard() }))
      log(`leave #${me.id} ${me.name} (${players.size} online)`)
    })
    socket.on('error', () => { /* close handler does the cleanup */ })
  })

  // ------------------------------------------------------------- tick / loop

  let lastSnapshot = 0
  let lastTick = Date.now()
  const snapshotEvery = 1000 / SNAPSHOT_HZ
  const tickTimer = setInterval(() => {
    const now = Date.now()
    // clamp dt so a stalled event loop cannot teleport mobs across the world
    const dt = Math.min(Math.max((now - lastTick) / 1000, 0), 0.25)
    lastTick = now

    mobs.update(dt, now)
    players.sweepRecent(now)

    if (now - lastSnapshot < snapshotEvery) return
    lastSnapshot = now
    for (const me of players.all()) {
      const list = players.visibleFrom(me).map((o) => ({
        id: o.id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch,
      }))
      const mobList = mobs.visibleFrom(me.x, me.z, players.interestRadius * 2).map(publicMob)
      players.send(me, serverMsg.snapshot({ t: now, players: list, mobs: mobList }))
    }
  }, 1000 / TICK_HZ)
  tickTimer.unref?.()

  persistence.start()

  // ------------------------------------------------------------------ boot

  const ready = new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject)
      const actual = httpServer.address().port
      log(`voxel server on ws://${host}:${actual}  seed=${world.seed}  world=${WORLD_X}x${WORLD_Y}x${WORLD_Z}  interest=${interestRadius}  data=${dataDir}`)
      resolve(actual)
    })
  })

  let closed = false
  async function close() {
    if (closed) return
    closed = true
    clearInterval(tickTimer)
    for (const p of players.all()) {
      try {
        p.socket.terminate()
      } catch { /* already dead */ }
    }
    players.players.clear()
    players.byToken.clear()
    players.bySocket.clear()
    players.recent.clear()
    persistence.stop()
    await new Promise((resolve) => {
      const guard = setTimeout(resolve, 1000)
      wss.close(() => {
        clearTimeout(guard)
        resolve()
      })
    })
    await new Promise((resolve) => httpServer.close(() => resolve()))
    log('server closed, world saved')
  }

  return {
    world, players, mobs, city, persistence, wss, httpServer, ready, close, log,
    get port() {
      const addr = httpServer.address()
      return typeof addr === 'object' && addr ? addr.port : port
    },
  }
}

// ------------------------------------------------------------------- runnable

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const server = startServer()
  await server.ready
  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    server.log(`received ${signal}, saving world and exiting`)
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
