// Alert coverage: which districts are lit by the devices in the city.
//
// Pure functions, no engine or network code, so the rules can be unit tested
// on their own. A district is lit when a powering device stands within its
// range of the district centre.

import { B } from './blocks.js'
import { DISTRICTS } from './districts.js'

/** Blocks that light up a district, and how far their light reaches (in blocks). */
export const POWER_RANGE = new Map([
  [B.BEACON, 16],
  [B.SIREN, 10],
])

/**
 * @param {{type:number,x:number,z:number}[]} devices placed alert devices
 * @returns {Object<string,boolean>} district id -> lit
 */
export function simulate(devices, districts = DISTRICTS) {
  const lit = {}
  for (const d of districts) {
    lit[d.id] = devices.some((dev) => {
      const range = POWER_RANGE.get(dev.type)
      if (range === undefined) return false
      return Math.hypot(dev.x - d.x, dev.z - d.z) <= range
    })
  }
  return lit
}

/** @returns {Object<number,number>} block type -> how many are placed */
export function countByType(devices) {
  const counts = {}
  for (const dev of devices) counts[dev.type] = (counts[dev.type] || 0) + 1
  return counts
}
