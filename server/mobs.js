// Server-authoritative animals.
//
// They are simulated here, in the same tick loop that broadcasts snapshots,
// using the same shared/collision.js the client uses. A mob therefore can never
// end up somewhere the client thinks is solid, and every client sees the same
// animal in the same place. Animals only wander: nothing can hurt them.

import {
  MOB_BY_ID, MOB_POPULATION, MOB_COUNT,
} from '../shared/mobs.js'
import { stepMovement, surfaceY, fits } from '../shared/collision.js'
import { WORLD_X, WORLD_Y, WORLD_Z, WATER_LEVEL } from '../shared/constants.js'

const GRAVITY = 28

export class MobRegistry {
  constructor({ world, log = console.log }) {
    this.world = world
    this.log = log
    this.mobs = new Map()
    this.nextId = 1
    this.pendingRespawns = []
    this.populate()
  }

  get count() {
    return this.mobs.size
  }

  all() {
    return [...this.mobs.values()]
  }

  get(id) {
    return this.mobs.get(id)
  }

  getByKey(key) {
    return [...this.mobs.values()].find((m) => MOB_BY_ID.get(m.kind).key === key)
  }

  /** @returns {{x:number,y:number,z:number}} plain position, safe to hand out */
  positionOf(mob) {
    return mob.pos
  }

  /** Drop the initial population somewhere sane: on land, not in each other. */
  populate() {
    for (const { kind, count } of MOB_POPULATION) {
      for (let i = 0; i < count; i++) this.spawn(kind)
    }
    this.log(`[mobs] spawned ${this.mobs.size}/${MOB_COUNT}`)
  }

  spawn(kind) {
    const def = MOB_BY_ID.get(kind)
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = 2 + Math.floor(Math.random() * (WORLD_X - 4))
      const z = 2 + Math.floor(Math.floor(Math.random() * (WORLD_Z - 4)))
      const y = surfaceY(this.world, x, z) + 1.02
      if (y < WATER_LEVEL + 1 || y > WORLD_Y - 3) continue
      if (!fits(this.world, x, y, z, def.halfW, def.height)) continue
      if ([...this.mobs.values()].some((m) => Math.hypot(m.pos.x - x, m.pos.z - z) < 3)) continue
      // pos and vel are separate objects on purpose: stepMovement writes one
      // and reads the other, and sharing a record makes a mob's height get
      // treated as its velocity and explode
      const mob = {
        id: this.nextId++,
        kind,
        pos: { x, y, z },
        vel: { x: 0, y: 0, z: 0 },
        yaw: Math.random() * Math.PI * 2,
        state: 'idle',
        timer: def.wanderIdle[0] + Math.random() * (def.wanderIdle[1] - def.wanderIdle[0]),
        dirX: 0,
        dirZ: 0,
        moving: false,
      }
      this.mobs.set(mob.id, mob)
      return mob
    }
    return null
  }

  kill(mob, now) {
    const def = MOB_BY_ID.get(mob.kind)
    this.mobs.delete(mob.id)
    const [lo, hi] = def.respawnMs
    this.pendingRespawns.push({ kind: mob.kind, at: now + lo + Math.random() * (hi - lo) })
  }

  /**
   * One AI step. Called at TICK_HZ with a fixed dt so the result does not
   * depend on how often the loop happens to fire.
   */
  update(dt, now) {
    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      if (now >= this.pendingRespawns[i].at) {
        this.spawn(this.pendingRespawns[i].kind)
        this.pendingRespawns.splice(i, 1)
      }
    }

    for (const mob of this.mobs.values()) {
      const def = MOB_BY_ID.get(mob.kind)
      mob.timer -= dt

      if (mob.timer <= 0) {
        if (mob.state === 'walk') {
          mob.state = 'idle'
          mob.timer = def.wanderIdle[0] + Math.random() * (def.wanderIdle[1] - def.wanderIdle[0])
        } else {
          // pick a new heading, biased to stay on the surface
          mob.state = 'walk'
          const a = Math.random() * Math.PI * 2
          mob.dirX = Math.cos(a)
          mob.dirZ = Math.sin(a)
          mob.timer = def.wanderMove[0] + Math.random() * (def.wanderMove[1] - def.wanderMove[0])
        }
      }

      const walking = mob.state === 'walk'
      const targetVx = walking ? mob.dirX * def.speed : 0
      const targetVz = walking ? mob.dirZ * def.speed : 0
      const k = Math.min(1, dt * 8)
      mob.vel.x += (targetVx - mob.vel.x) * k
      mob.vel.z += (targetVz - mob.vel.z) * k

      const before = { x: mob.pos.x, z: mob.pos.z }
      const res = stepMovement(this.world, mob.pos, mob.vel, dt, def.halfW, def.height, GRAVITY)

      // a wall in front, or a drop just ahead (sheep-like: do not walk off a
      // big one): pick a new heading, once per tick. Flipping the heading in two
      // separate checks let them cancel each other out and pinned the animal.
      const blocked = res.hitX || res.hitZ
      if (mob.state === 'walk' && (blocked || this._cliffAhead(mob))) {
        this._turn(mob, def)
      }

      const moved = Math.hypot(mob.pos.x - before.x, mob.pos.z - before.z)
      mob.moving = moved > 0.002
      if (mob.moving) {
        // face the direction of travel, smoothed
        const want = Math.atan2(mob.dirX, mob.dirZ)
        let d = want - mob.yaw
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        mob.yaw += d * Math.min(1, dt * 8)
      }

      // fell out of the world
      if (mob.pos.y < -8) this.kill(mob, now)
    }
  }

  /**
   * Stop and pause. The next walk picks a fresh heading. Turning straight into
   * a new heading would loop forever in a corner where every direction is
   * blocked, so the animal first stands still for a moment.
   */
  _turn(mob, def) {
    mob.state = 'idle'
    mob.timer = def.wanderIdle[0] + Math.random() * (def.wanderIdle[1] - def.wanderIdle[0])
    mob.vel.x = 0
    mob.vel.z = 0
  }

  /** Is there a drop of more than `steps` blocks just ahead? */
  _cliffAhead(mob) {
    const aheadX = mob.pos.x + mob.dirX * 0.8
    const aheadZ = mob.pos.z + mob.dirZ * 0.8
    const here = surfaceY(this.world, Math.floor(mob.pos.x), Math.floor(mob.pos.z))
    const there = surfaceY(this.world, Math.floor(aheadX), Math.floor(aheadZ))
    if (there < 0) return true
    return here - there > 3
  }

  /** Mobs the receiver should know about, given their player position. */
  visibleFrom(px, pz, radius) {
    const r2 = radius * radius
    const out = []
    for (const m of this.mobs.values()) {
      const dx = m.pos.x - px
      const dz = m.pos.z - pz
      if (dx * dx + dz * dz > r2) continue
      out.push(m)
    }
    out.sort((a, b) => a.id - b.id)
    return out
  }
}

export { MOB_BY_ID, MOB_COUNT }
