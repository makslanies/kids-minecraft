// Wire protocol: JSON messages over a raw WebSocket.
//
// Pure functions only, shared by client and server so the two can never drift
// apart. `tryDecode` is the single gate every inbound message passes through.

export const C2S = {
  HELLO: 'hello',
  INPUT: 'input',
  BLOCK_EDIT: 'blockEdit',
  PING: 'ping',
  CHECK: 'check',
}

export const S2C = {
  INIT: 'init',
  PLAYER_JOIN: 'playerJoin',
  PLAYER_LEAVE: 'playerLeave',
  SNAPSHOT: 'snapshot',
  BLOCK_CHANGED: 'blockChanged',
  EDIT_REJECTED: 'editRejected',
  CORRECTION: 'correction',
  PONG: 'pong',
  ERROR: 'error',
  MOB_GONE: 'mobGone',
  CITY: 'city',
  SCORES: 'scores',
}

export const ERR = {
  BAD_MESSAGE: 'bad_message',
  BAD_NAME: 'bad_name',
  NOT_HELLOED: 'not_helloed',
  OUT_OF_BOUNDS: 'out_of_bounds',
  BAD_BLOCK: 'bad_block',
  RATE_LIMITED: 'rate_limited',
  SPEED: 'speed',
  SERVER_FULL: 'server_full',
  CONFLICT: 'conflict',
}

export const ERRORS = {
  [ERR.BAD_MESSAGE]: 'сообщение не понятно',
  [ERR.BAD_NAME]: 'неверное имя',
  [ERR.NOT_HELLOED]: 'сначала войди в игру',
  [ERR.OUT_OF_BOUNDS]: 'это место за пределами мира',
  [ERR.BAD_BLOCK]: 'этот блок нельзя поставить или сломать',
  [ERR.RATE_LIMITED]: 'слишком быстро, подожди немного',
  [ERR.SPEED]: 'слишком быстро, возвращаю назад',
  [ERR.SERVER_FULL]: 'в игре уже много ребят',
  [ERR.CONFLICT]: 'этот блок уже изменил кто-то другой',
}

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const int = (v) => Number.isInteger(v)
const optInt = (v) => v === undefined || v === null || Number.isInteger(v)
const str = (v) => typeof v === 'string'
const optStr = (v) => v === undefined || v === null || typeof v === 'string'

/** Required-field spec per inbound message type. */
const SPEC = {
  [C2S.HELLO]: { name: str, resumeToken: optStr },
  [C2S.INPUT]: { seq: int, x: num, y: num, z: num, yaw: num, pitch: num, t: num, item: optInt },
  [C2S.BLOCK_EDIT]: { seq: int, x: int, y: int, z: int, block: int, expected: int, tool: optInt },
  [C2S.PING]: { t: num },
  [C2S.CHECK]: {},
}

export const INBOUND_TYPES = Object.keys(SPEC)

/**
 * `type` is written last on purpose: it is the envelope discriminator and must
 * never be shadowed by a payload field (a block id called `type` used to do
 * exactly that and silently corrupted every block edit).
 */
export function encode(type, payload = {}) {
  return JSON.stringify({ ...payload, type })
}

/**
 * @returns {{ok:true,msg:object}|{ok:false,reason:'json'|'shape'|'type'}}
 */
export function tryDecode(raw) {
  let msg
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : String(raw))
  } catch {
    return { ok: false, reason: 'json' }
  }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, reason: 'shape' }
  }
  const spec = SPEC[msg.type]
  if (!spec) return { ok: false, reason: 'type' }
  for (const key of Object.keys(spec)) {
    if (!spec[key](msg[key])) return { ok: false, reason: 'shape' }
  }
  return { ok: true, msg }
}

/** Server -> client helpers (no validation needed, both ends are ours). */
export const serverMsg = {
  init: (p) => encode(S2C.INIT, p),
  playerJoin: (p) => encode(S2C.PLAYER_JOIN, p),
  playerLeave: (p) => encode(S2C.PLAYER_LEAVE, p),
  snapshot: (p) => encode(S2C.SNAPSHOT, p),
  blockChanged: (p) => encode(S2C.BLOCK_CHANGED, p),
  editRejected: (p) => encode(S2C.EDIT_REJECTED, p),
  correction: (p) => encode(S2C.CORRECTION, p),
  pong: (p) => encode(S2C.PONG, p),
  error: (code, message) => encode(S2C.ERROR, { code, message: message || ERRORS[code] || code }),
  city: (p) => encode(S2C.CITY, p),
  scores: (p) => encode(S2C.SCORES, p),
  mobGone: (p) => encode(S2C.MOB_GONE, p),
}
