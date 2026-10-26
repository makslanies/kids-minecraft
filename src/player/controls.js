// First person controls: pointer lock, voxel AABB collision, DDA block picking.

import * as THREE from 'three'
import {
  PLAYER_HEIGHT, PLAYER_HALF_WIDTH, GRAVITY, JUMP_SPEED, WALK_SPEED, SPRINT_SPEED, REACH,
} from '../../shared/constants.js'
import { B } from '../../shared/blocks.js'
import { stepMovement } from '../../shared/collision.js'
import { toolReach } from '../../shared/items.js'

const HW = PLAYER_HALF_WIDTH
const H = PLAYER_HEIGHT

/** Amanatides & Woo voxel traversal.
 * @returns {{x,y,z,nx,ny,nz,id,dist}|null}
 */
export function raycastVoxel(world, origin, dir, maxDist = REACH) {
  let x = Math.floor(origin.x)
  let y = Math.floor(origin.y)
  let z = Math.floor(origin.z)

  const stepX = dir.x > 0 ? 1 : -1
  const stepY = dir.y > 0 ? 1 : -1
  const stepZ = dir.z > 0 ? 1 : -1

  const tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x)
  const tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y)
  const tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z)

  let tMaxX = dir.x === 0 ? Infinity : (dir.x > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX
  let tMaxY = dir.y === 0 ? Infinity : (dir.y > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY
  let tMaxZ = dir.z === 0 ? Infinity : (dir.z > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ

  let nx = 0
  let ny = 0
  let nz = 0
  let t = 0

  while (t <= maxDist) {
    const id = world.get(x, y, z)
    if (id !== B.AIR && id !== B.WATER) {
      return { x, y, z, nx, ny, nz, id, dist: t }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX
      t = tMaxX
      tMaxX += tDeltaX
      nx = -stepX
      ny = 0
      nz = 0
    } else if (tMaxY < tMaxZ) {
      y += stepY
      t = tMaxY
      tMaxY += tDeltaY
      nx = 0
      ny = -stepY
      nz = 0
    } else {
      z += stepZ
      t = tMaxZ
      tMaxZ += tDeltaZ
      nx = 0
      ny = 0
      nz = -stepZ
    }
  }
  return null
}

export class PlayerController {
  constructor(camera, domElement) {
    this.camera = camera
    this.dom = domElement
    this.pos = new THREE.Vector3(0, 0, 0)
    this.vel = new THREE.Vector3(0, 0, 0)
    this.yaw = 0
    this.pitch = 0
    this.onGround = false
    this.locked = false
    this.keys = new Set()
    /** on-screen stick (touch): x right, y forward, each -1..1 */
    this.touchMove = { x: 0, y: 0 }
    this.touchJump = false
    this.sprinting = false
    this.dead = false
    /** progress 0..1 of the arm swing, driven by the HUD/controller each frame */
    this.swing = 0
    this.swinging = 0

    this._forward = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._wish = new THREE.Vector3()
    this._dir = new THREE.Vector3()

    this.onKey = this.onKey.bind(this)
    this.onMouseMove = this.onMouseMove.bind(this)

    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom
      this.onLockChange?.(this.locked)
    })
  }

  onKey(ev) {
    if (ev.code === 'Space') ev.preventDefault()
    if (ev.type === 'keydown') this.keys.add(ev.code)
    else this.keys.delete(ev.code)
  }

  onMouseMove(ev) {
    if (!this.locked) return
    this.look(ev.movementX, ev.movementY)
  }

  /** Turn the view by a pixel delta (mouse while locked, or a touch drag). */
  look(dx, dy) {
    const s = 0.0022
    this.yaw -= dx * s
    this.pitch -= dy * s
    const lim = Math.PI / 2 - 0.001
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch))
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2
  }

  requestLock() {
    this.dom.requestPointerLock?.()
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z)
    this.vel.set(0, 0, 0)
  }

  /** True when the player's body is inside a water cell. */
  inWater(world) {
    const mid = this.pos.y + H * 0.5
    return world.get(
      Math.floor(this.pos.x),
      Math.floor(mid),
      Math.floor(this.pos.z),
    ) === B.WATER
  }

  update(dt, world) {
    const water = this.inWater(world)
    this.sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED

    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))

    let fx = 0
    let fz = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1
    fx = Math.max(-1, Math.min(1, fx + this.touchMove.x))
    fz = Math.max(-1, Math.min(1, fz + this.touchMove.y))
    const jump = this.keys.has('Space') || this.touchJump

    this._wish.set(0, 0, 0)
    if (fx || fz) {
      this._wish.addScaledVector(this._forward, fz).addScaledVector(this._right, fx).normalize()
    }

    const targetX = this._wish.x * speed
    const targetZ = this._wish.z * speed
    // snappy but not instant
    const accel = water ? 6 : 16
    const k = Math.min(1, dt * accel)
    this.vel.x += (targetX - this.vel.x) * k
    this.vel.z += (targetZ - this.vel.z) * k

    // stepMovement owns gravity, so we only set the impulse here. Applying it
    // twice halves the jump (and doubles the fall speed) without looking wrong
    // enough to notice until you cannot clear a single block.
    if (water) {
      if (jump) this.vel.y = Math.min(this.vel.y + 26 * dt, 3.4)
    } else if (jump && this.onGround) {
      this.vel.y = JUMP_SPEED
      this.onGround = false
    }
    this.vel.y = Math.max(this.vel.y, -60)

    if (this.dead) {
      // still fall, but do not steer
      this.vel.x = 0
      this.vel.z = 0
    }

    const res = stepMovement(world, this.pos, this.vel, dt, HW, H, water ? GRAVITY * 0.3 : GRAVITY)
    this.onGround = res.onGround

    this.camera.position.set(this.pos.x, this.pos.y + H * 0.9, this.pos.z)
    this.camera.rotation.set(0, 0, 0)
    this.camera.rotateY(this.yaw)
    this.camera.rotateX(this.pitch)

    if (this.swinging > 0) {
      this.swinging = Math.max(0, this.swinging - dt * 3.2)
      this.swing = Math.sin((1 - this.swinging) * Math.PI)
    } else {
      this.swing = 0
    }
  }

  startSwing() {
    this.swinging = 1
  }

  /** The block under the crosshair, within the reach of the held tool. */
  pick(world, toolId) {
    this._dir.set(0, 0, -1).applyQuaternion(this.camera.quaternion)
    return raycastVoxel(world, this.camera.position, this._dir, toolReach(toolId))
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
    document.removeEventListener('mousemove', this.onMouseMove)
  }
}
