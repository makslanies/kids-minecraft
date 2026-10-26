// Client entry point: wires connection, world, renderer, controls and HUD.

import * as THREE from 'three'
import './ui/hud.css'

import { WorldRenderer } from './world/renderer.js'
import { ClientWorld } from './world/world.js'
import { Reconciler } from './net/reconciler.js'
import { Connection, resolveServerUrl } from './net/connection.js'
import { PlayerController } from './player/controls.js'
import { RemotePlayers } from './player/remote.js'
import { MobView } from './player/mobs.js'
import { HandView } from './player/hand.js'
import { LetterSign } from './world/letters.js'
import { Hud } from './ui/hud.js'
import { TouchControls, isTouchDevice } from './ui/touch.js'
import { S2C, C2S, ERRORS } from '../shared/protocol.js'
import { MISSIONS } from '../shared/missions.js'
import { INPUT_HZ } from '../shared/constants.js'
import { B, BLOCKS } from '../shared/blocks.js'
import { HOTBAR, TOOL_BY_ID, toolSpeedOn, isTool, breakDelay } from '../shared/items.js'

const app = document.getElementById('app')
const hud = new Hud(document.body)
const worldRenderer = new WorldRenderer(app)
const world = new ClientWorld()
const remotes = new RemotePlayers(worldRenderer.scene)
const mobView = new MobView(worldRenderer.scene)
const letterSign = new LetterSign(worldRenderer.scene)
const dom = worldRenderer.renderer.domElement
const controller = new PlayerController(worldRenderer.camera, dom)
// what you are holding, drawn in view space
const handView = new HandView(worldRenderer.camera, worldRenderer.atlas)
hud.onSelect = (item) => handView.setItem(item)

// Tablets get on-screen controls and no mouse: no pointer lock, no right-click.
const isTouch = isTouchDevice()
document.body.classList.toggle('touch', isTouch)
const touch = isTouch
  ? new TouchControls({
    root: document.body,
    canvas: dom,
    controller,
    onPlace: () => placeBlock(),
    onCheck: () => checkCity(),
  })
  : null

const serverUrl = resolveServerUrl()
const params = new URLSearchParams(location.search)
const autoJoin = params.get('autoplay') === '1'
const randomName = `Игрок-${Math.floor(1000 + Math.random() * 9000)}`
const defaultName = params.get('name') || randomName

let joined = false
let selfId = null
let selfName = defaultName
let inputSeq = 1
let buildMs = 0
let fps = 0
/** client-side pacing so breaking feels like the tool, not just the server */
let breakReadyAt = 0

// ---------------------------------------------------------------- selection

const selection = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.85 }),
)
selection.visible = false
worldRenderer.add(selection)

// ------------------------------------------------------------- networking

const reconciler = new Reconciler({
  world,
  renderer: worldRenderer,
  send: (x, y, z, block, expected, seq) => {
    connection.send(C2S.BLOCK_EDIT, { seq, x, y, z, block, expected, tool: hud.selectedTool })
  },
})

const connection = new Connection({
  url: serverUrl,
  name: defaultName,
  onStatus: (state) => {
    hud.setStatus(state)
    hud.setJoinEnabled(state === 'connected', state === 'connected' ? 'Играть' : 'Подключение…')
    if (state !== 'connected') {
      joined = false
      hud.showOverlay(true)
    }
  },
  onOpen: () => {
    // The name from ?name= already went out in the hello, so autoplay only
    // needs to get out of the way — reconnecting here would loop forever.
    hud.setJoinEnabled(true, autoJoin ? 'В игре' : 'Играть')
    if (autoJoin) hud.setHint('Входим…')
  },
  onMessage: handleMessage,
})

// ------------------------------------------------------------------ routing

function handleMessage(msg) {
  switch (msg.type) {
    case S2C.INIT: return onInit(msg)
    case S2C.PLAYER_JOIN: remotes.add(msg); return
    case S2C.PLAYER_LEAVE: remotes.remove(msg.id); return
    case S2C.SNAPSHOT:
      remotes.applySnapshot(msg.players, msg.t)
      if (msg.mobs) mobView.applySnapshot(msg.mobs)
      return
    case S2C.BLOCK_CHANGED: reconciler.onBlockChanged(msg); return
    case S2C.EDIT_REJECTED:
      reconciler.onEditRejected(msg)
      hud.toast('Этот блок уже изменил кто-то другой', 'info')
      return
    case S2C.CORRECTION:
      controller.setPosition(msg.x, msg.y, msg.z)
      controller.yaw = msg.yaw
      controller.pitch = msg.pitch
      return
    case S2C.MOB_GONE: mobView.remove(msg.id); return
    case S2C.CITY: onCity(msg); return
    case S2C.SCORES: hud.setScores(msg.scores, selfId); return
    case S2C.ERROR:
      // a dropped break is normal pacing, not a problem
      if (msg.code === 'too_fast') return
      hud.toast(msg.message || ERRORS[msg.code] || msg.code)
      return
    default:
  }
}

function onInit(msg) {
  const t0 = performance.now()
  selfId = msg.selfId
  selfName = msg.name
  connection.name = msg.name

  world.generate(msg.seed)
  world.applyEdits(msg.edits)

  worldRenderer.markAll()
  worldRenderer.flush(world)
  worldRenderer.countTriangles()
  buildMs = Math.round(performance.now() - t0)

  const me = msg.players.find((p) => p.id === selfId)
  if (me) controller.setPosition(me.x, me.y, me.z)

  for (const p of msg.players) {
    if (p.id !== selfId) remotes.add(p)
  }
  if (msg.mobs) mobView.applySnapshot(msg.mobs)

  hud.attachAtlas(worldRenderer.atlas.image)
  hud.offerMission(msg.city?.mission)
  letterSign.sync(msg.city?.cube)
  hud.setScores(msg.scores, selfId)
  handView.setItem(HOTBAR[hud.selected])
  hud.showOverlay(false)
  hud.setHint(isTouch ? 'Проведи пальцем по экрану, чтобы смотреть' : 'Нажми на экран, чтобы смотреть по сторонам')
  hud.toast(`Ты в игре, ${msg.name}!`, 'info')

  joined = true
  reconciler.reset()
}

function onCity(msg) {
  hud.offerMission(msg.mission)
  letterSign.sync(msg.cube)
  if (msg.reward) {
    hud.toast(`${msg.reward.by} нашёл букву ${msg.reward.letter}! +${msg.reward.points}`, 'info')
  }
  if (msg.error === 'no_dispatch') hud.toast('Нужна диспетчерская: поставь её и проверь город', 'error')
  for (const id of msg.newlyCompleted || []) {
    const mission = MISSIONS.find((m) => m.id === id)
    if (mission) hud.toast(`Миссия выполнена: ${mission.title}`, 'info')
  }
}

// ------------------------------------------------------------------ joining

function join() {
  const name = (hud.nameInput.value || defaultName).trim().slice(0, 16) || defaultName
  connection.name = name
  hud.showOverlay(false)
  hud.setHint('Подключение…')
  // hello carries the name and may only be sent once per socket, so a name
  // change needs a fresh connection (the resume token keeps the identity).
  connection.reconnect()
}

hud.joinBtn.addEventListener('click', join)
hud.nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !hud.joinBtn.disabled) join()
})
hud.nameInput.value = defaultName

// ----------------------------------------------------------------- controls

dom.addEventListener('contextmenu', (e) => e.preventDefault())

/** Break the block under the crosshair, paced by the held tool. */
function breakBlock() {
  if (!joined) return
  const hit = controller.pick(world, hud.selectedTool)
  if (!hit) return
  if (Date.now() < breakReadyAt) return
  breakReadyAt = Date.now() + breakDelay(hud.selectedTool, hit.id) * 1000
  controller.startSwing()
  reconciler.requestEdit(hit.x, hit.y, hit.z, B.AIR)
}

/** Place the selected block against the face under the crosshair. */
function placeBlock() {
  if (!joined) return
  const block = hud.selectedBlock
  if (!block) return
  const hit = controller.pick(world, hud.selectedTool)
  if (!hit) return
  const tx = hit.x + hit.nx
  const ty = hit.y + hit.ny
  const tz = hit.z + hit.nz
  const current = world.get(tx, ty, tz)
  if (current !== B.AIR && current !== B.WATER) return
  if (overlapsPlayer(tx, ty, tz)) return
  if (Date.now() < breakReadyAt) return
  breakReadyAt = Date.now() + breakDelay(hud.selectedTool, hit.id) * 1000
  reconciler.requestEdit(tx, ty, tz, block)
}

/** "Проверить город", from the C key or the check button. */
function checkCity() {
  if (!joined) return
  connection.send(C2S.CHECK, {})
}

dom.addEventListener('mousedown', (e) => {
  if (!joined || isTouch) return
  if (!controller.locked) {
    controller.requestLock()
    return
  }
  if (e.button === 0) breakBlock()
  if (e.button === 2) placeBlock()
})

dom.addEventListener('wheel', (e) => {
  if (!joined) return
  hud.cycle(e.deltaY > 0 ? 1 : -1)
}, { passive: true })

window.addEventListener('keydown', (e) => {
  if (!joined) return
  if (e.code === 'Escape') return
  if (e.code === 'KeyC') {
    checkCity()
    return
  }
  const n = Number(e.key)
  if (Number.isInteger(n) && n >= 1 && n <= HOTBAR.length) {
    hud.select(n - 1)
  }
})

controller.onLockChange = (locked) => {
  hud.setHint(locked ? '' : 'Нажми на экран, чтобы продолжить')
}

/** Would a block at this cell intersect the player AABB? */
function overlapsPlayer(x, y, z) {
  const p = controller.pos
  return (
    p.x + 0.3 > x && p.x - 0.3 < x + 1
    && p.z + 0.3 > z && p.z - 0.3 < z + 1
    && p.y + 1.8 > y && p.y < y + 1
  )
}

// --------------------------------------------------------------- main loop

const timer = new THREE.Timer()
let fpsAcc = 0
let fpsFrames = 0
let inputAcc = 0

function tick() {
  requestAnimationFrame(tick)
  timer.update()
  const dt = Math.min(timer.getDelta(), 0.05)

  fpsAcc += dt
  fpsFrames++
  if (fpsAcc >= 0.5) {
    fps = Math.round(fpsFrames / fpsAcc)
    fpsAcc = 0
    fpsFrames = 0
  }

  if (joined) {
    if (touch?.breaking) breakBlock()
    controller.update(dt, world)
    handView.update(controller.swing, Math.hypot(controller.vel.x, controller.vel.z), dt)
    remotes.update(connection.serverTime())
    mobView.update()


    inputAcc += dt
    const every = 1 / INPUT_HZ
    if (inputAcc >= every) {
      inputAcc = inputAcc % every
      connection.send(C2S.INPUT, {
        seq: inputSeq++,
        x: controller.pos.x,
        y: controller.pos.y,
        z: controller.pos.z,
        yaw: controller.yaw,
        pitch: controller.pitch,
        t: connection.serverTime(),
        item: hud.selectedTool,
      })
    }
  }

  const tool = hud.selectedTool
  const hit = joined ? controller.pick(world, tool) : null

  if (hit) {
    selection.visible = true
    selection.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
    const speed = toolSpeedOn(tool, hit.id)
    hud.setTargetInfo(speed > 1.2
      ? `Быстро копается: ${BLOCK_NAME(hit.id)}`
      : '')
  } else {
    selection.visible = false
    hud.setTargetInfo('')
  }

  hud.setSwing(controller.swinging > 0 ? 1 - controller.swinging : 0)
  if (!joined) handView.update(0, 0, dt)

  worldRenderer.flush(world)
  worldRenderer.render()
}

const BLOCK_NAME = (id) => BLOCKS[id]?.name || 'block'
const TOOL_NAME = (id) => (isTool(id) ? TOOL_BY_ID.get(id).name : 'руки')

// ------------------------------------------------------------- debug handle

window.__voxel = {
  serverUrl,
  three: { scene: worldRenderer.scene, camera: worldRenderer.camera, renderer: worldRenderer.renderer },
  getState: () => ({
    state: connection.state,
    joined,
    selfId,
    name: selfName,
    rtt: connection.rtt,
    fps,
    buildMs,
    players: remotes.count + (joined ? 1 : 0),
    pendingEdits: reconciler.pendingCount,
    worldVersion: world.version,
    seed: world.seed,
    mobs: mobView.count,
  }),
  getBlock: (x, y, z) => world.get(x, y, z),
  pick: () => controller.pick(world, hud.selectedTool),
  isSolidAt: (x, y, z) => world.isSolid(x, y, z),
  getPlayers: () => remotes.list(),
  getMobs: () => mobView.list(),
  getTriangles: () => worldRenderer.triangles || worldRenderer.countTriangles(),
  /** Drive an edit from the console / automation. */
  edit: (x, y, z, block) => reconciler.requestEdit(x, y, z, block),
  selectSlot: (i) => { hud.select(i); return { ...HOTBAR[hud.selected], tool: hud.selectedTool, block: hud.selectedBlock } },
  getSelected: () => ({ ...HOTBAR[hud.selected], tool: hud.selectedTool, block: hud.selectedBlock }),
  setLook: (yaw, pitch) => { controller.yaw = yaw; controller.pitch = pitch },
  getLook: () => ({ yaw: controller.yaw, pitch: controller.pitch }),
  teleport: (x, y, z) => controller.setPosition(x, y, z),
  getPosition: () => ({ x: controller.pos.x, y: controller.pos.y, z: controller.pos.z }),
  hotbar: HOTBAR,
}

hud.setStatus('idle')
// the block swatches in the hotbar read pixels from the atlas, so wait for it
worldRenderer.atlas.ready.then(() => {
  connection.connect()
  tick()
})
