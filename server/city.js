// Server side of the kids' city: finds the alert devices, runs "Проверить
// город", and keeps which missions are done. Everything else (coverage rules,
// mission goals) lives in shared/ so the client can show the same thing.

import { WORLD_X, WORLD_Y, WORLD_Z, PLAZA, WATER_LEVEL } from '../shared/constants.js'
import { B, isSolid } from '../shared/blocks.js'
import { DISTRICTS } from '../shared/districts.js'
import { MISSIONS, LETTER_REWARD, LETTER_COLORS, isMet, currentMission } from '../shared/missions.js'
import { simulate, countByType } from '../shared/alert.js'

const DEVICE_BLOCKS = new Set([B.BEACON, B.SIREN, B.SENSOR, B.DISPATCH])
/** How far from the plaza the letter cube may appear, in blocks. */
const LETTER_SPREAD = 20

export class CityState {
  constructor({ world }) {
    this.world = world
    /** ids of missions already completed, in the order they were completed */
    this.completed = []
    /** the letter cube in the world right now: {x,y,z,letter,color} or null */
    this.cube = null
  }

  restore(ids) {
    const known = new Set(MISSIONS.map((m) => m.id))
    this.completed = [...new Set(ids)].filter((id) => known.has(id))
  }

  persistState() {
    return { cube: this.cube }
  }

  restoreLetters({ cube } = {}) {
    this.cube = cube && Number.isInteger(cube.x) && Number.isInteger(cube.y) && Number.isInteger(cube.z)
      ? { x: cube.x, y: cube.y, z: cube.z, letter: String(cube.letter), color: String(cube.color || LETTER_COLORS[0]) }
      : null
  }

  /** The letter mission that is current right now, or null. */
  letterMission() {
    const mission = currentMission(this.completed)
    return mission && mission.goal.type === 'letter' ? mission : null
  }

  /**
   * Keeps exactly one letter cube in the world while a letter mission is
   * current. Call after every change to the mission list or on startup.
   * @returns {Array<{x:number,y:number,z:number,block:number}>} block changes to broadcast
   */
  ensureCube() {
    const mission = this.letterMission()
    const changes = []
    const want = mission ? mission.goal.letter : null

    if (this.cube && (this.cube.letter !== want || this.world.get(this.cube.x, this.cube.y, this.cube.z) !== B.LETTER)) {
      const { x, y, z } = this.cube
      if (this.world.get(x, y, z) === B.LETTER) {
        this.world.set(x, y, z, B.AIR)
        changes.push({ x, y, z, block: B.AIR })
      }
      this.cube = null
    }
    if (!mission || this.cube) return changes

    const spot = this.findSpot()
    if (!spot) return changes
    this.world.set(spot.x, spot.y, spot.z, B.LETTER)
    const color = LETTER_COLORS[Math.floor(Math.random() * LETTER_COLORS.length)]
    this.cube = { ...spot, letter: want, color }
    changes.push({ x: spot.x, y: spot.y, z: spot.z, block: B.LETTER })
    return changes
  }

  /** A random open cell on the ground near the plaza, above the water. */
  findSpot() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = PLAZA.x + Math.floor(Math.random() * (LETTER_SPREAD * 2 + 1)) - LETTER_SPREAD
      const z = PLAZA.z + Math.floor(Math.random() * (LETTER_SPREAD * 2 + 1)) - LETTER_SPREAD
      if (x < 2 || x > WORLD_X - 3 || z < 2 || z > WORLD_Z - 3) continue
      for (let y = WORLD_Y - 2; y > WATER_LEVEL; y--) {
        if (isSolid(this.world.get(x, y, z)) && this.world.get(x, y + 1, z) === B.AIR) {
          return { x, y: y + 1, z }
        }
      }
    }
    return null
  }

  /**
   * Called after a player breaks a block. Only the active letter cube counts.
   * @returns {null | {letter:string, points:number, newlyCompleted:string[], changes:object[]}}
   */
  letterBroken(x, y, z) {
    const cube = this.cube
    if (!cube || cube.x !== x || cube.y !== y || cube.z !== z) return null
    const mission = this.letterMission()
    if (!mission) return null
    this.cube = null
    this.completed.push(mission.id)
    const changes = this.ensureCube()
    return { letter: cube.letter, points: LETTER_REWARD, newlyCompleted: [mission.id], changes }
  }

  /** Every placed alert device in the world. Scanned on demand, not tracked. */
  devices() {
    const out = []
    for (let y = 0; y < WORLD_Y; y++) {
      for (let z = 0; z < WORLD_Z; z++) {
        for (let x = 0; x < WORLD_X; x++) {
          const type = this.world.get(x, y, z)
          if (DEVICE_BLOCKS.has(type)) out.push({ type, x, y, z })
        }
      }
    }
    return out
  }

  /** The city as the client should see it right now. */
  status(devices = this.devices()) {
    const lit = simulate(devices, DISTRICTS)
    const counts = countByType(devices)
    const mission = currentMission(this.completed)
    return {
      lit,
      counts,
      completed: [...this.completed],
      cube: this.cube ? { ...this.cube } : null,
      mission: mission ? { id: mission.id, title: mission.title, hint: mission.hint } : null,
      done: mission === null,
    }
  }

  /**
   * "Проверить город". Needs a dispatch console, like the idea says: the child
   * walks to it and presses the big button.
   * @returns {{ok:boolean, error?:string, newlyCompleted:string[], status:object}}
   */
  check() {
    const devices = this.devices()
    if (!devices.some((d) => d.type === B.DISPATCH)) {
      return { ok: false, error: 'no_dispatch', newlyCompleted: [], status: this.status(devices) }
    }
    const before = this.status(devices)
    const newlyCompleted = []
    for (const mission of MISSIONS) {
      if (this.completed.includes(mission.id)) continue
      if (isMet(mission, before)) {
        this.completed.push(mission.id)
        newlyCompleted.push(mission.id)
      }
    }
    return { ok: true, newlyCompleted, status: this.status(devices) }
  }
}
