// The kids' city: coverage rules, the letter hunt, and the points of each player.

import test from 'node:test'
import assert from 'node:assert/strict'

import { B, isSolid } from '../shared/blocks.js'
import { DISTRICT_BY_ID } from '../shared/districts.js'
import { simulate, countByType } from '../shared/alert.js'
import { MISSIONS, LETTERS, LETTER_REWARD, LETTER_COLORS, isMet, currentMission } from '../shared/missions.js'
import { AuthoritativeWorld } from '../server/world.js'
import { CityState } from '../server/city.js'
import { startTestServer, TestClient, sleep, C2S, S2C, EDIT_GAP_MS } from './harness.js'

const park = DISTRICT_BY_ID.get('park')
const LETTER_IDS = MISSIONS.map((m) => m.id)

// ----------------------------------------------------------------- coverage

test('a beacon lights only the districts within its range', () => {
  const lit = simulate([{ type: B.BEACON, x: park.x + 2, z: park.z }])
  assert.equal(lit.park, true)
  const far = simulate([{ type: B.BEACON, x: park.x + 40, z: park.z }])
  assert.equal(far.park, false)
})

test('a siren has a shorter reach than a beacon', () => {
  const far = { type: B.SIREN, x: park.x + 12, z: park.z }
  assert.equal(simulate([far]).park, false, 'a siren 12 blocks away does not reach')
  assert.equal(simulate([{ ...far, type: B.BEACON }]).park, true, 'a beacon does')
})

test('sensors and dispatch consoles do not light anything', () => {
  const lit = simulate([{ type: B.SENSOR, x: park.x, z: park.z }, { type: B.DISPATCH, x: park.x, z: park.z }])
  assert.ok(Object.values(lit).every((v) => v === false))
})

test('countByType counts every placed device', () => {
  const counts = countByType([{ type: B.BEACON }, { type: B.BEACON }, { type: B.SIREN }])
  assert.equal(counts[B.BEACON], 2)
  assert.equal(counts[B.SIREN], 1)
})

// ----------------------------------------------------------------- missions

test('the alphabet is the whole Russian one, А to Я, one mission per letter', () => {
  assert.equal(LETTERS.length, 33)
  assert.equal(LETTERS[0], 'А')
  assert.equal(LETTERS[LETTERS.length - 1], 'Я')
  assert.deepEqual(LETTER_IDS, LETTERS.map((l) => `letter-${l}`))
  assert.ok(MISSIONS.every((m) => m.goal.type === 'letter'), 'no other kind of mission is left')
})

test('missions are checked in order and a finished one is not offered again', () => {
  assert.equal(currentMission([]).id, 'letter-А')
  assert.equal(currentMission(['letter-А']).id, 'letter-Б')
  assert.equal(currentMission(LETTER_IDS), null)
})

test('letter missions are never done by a check', () => {
  const letter = MISSIONS[0]
  assert.equal(isMet(letter, { counts: { [B.BEACON]: 9 }, lit: { park: true } }), false)
})

// ------------------------------------------------------------- server state

function cityWithWorld() {
  const world = new AuthoritativeWorld({ seed: 1337 })
  return { world, city: new CityState({ world }) }
}

test('a check without a dispatch console changes nothing', () => {
  const { world, city } = cityWithWorld()
  world.set(park.x, 40, park.z, B.BEACON)
  const res = city.check()
  assert.equal(res.ok, false)
  assert.equal(res.error, 'no_dispatch')
  assert.deepEqual(city.completed, [])
})

test('a check does not finish letter missions even with a dispatch console and devices', () => {
  const { world, city } = cityWithWorld()
  world.set(10, 40, 10, B.DISPATCH)
  world.set(park.x + 2, 40, park.z, B.BEACON)
  const res = city.check()
  assert.equal(res.ok, true)
  assert.deepEqual(res.newlyCompleted, [])
  assert.deepEqual(city.completed, [])
})

test('restore keeps only known mission ids, without duplicates', () => {
  const { city } = cityWithWorld()
  city.restore(['letter-А', 'letter-А', 'made-up', 'letter-Б'])
  assert.deepEqual(city.completed, ['letter-А', 'letter-Б'])
})

// ------------------------------------------------------------- letter hunt

test('ensureCube puts one golden letter cube above the ground near the plaza', () => {
  const { world, city } = cityWithWorld()
  const changes = city.ensureCube()
  assert.equal(changes.length, 1)
  const { x, y, z, letter } = city.cube
  assert.equal(letter, 'А')
  assert.equal(world.get(x, y, z), B.LETTER)
  assert.ok(isSolid(world.get(x, y - 1, z)), 'the cube sits on something solid')
  assert.ok(Math.abs(x - 32) <= 20 && Math.abs(z - 32) <= 20, 'close to the plaza')
  assert.ok(LETTER_COLORS.includes(city.cube.color), 'the letter gets one of the colours')
  assert.deepEqual(city.ensureCube(), [], 'a second call does not add another cube')
})

test('breaking the letter cube finishes the letter and moves on to the next one', () => {
  const { world, city } = cityWithWorld()
  city.ensureCube()
  const first = { ...city.cube }
  world.set(first.x, first.y, first.z, B.AIR)

  const res = city.letterBroken(first.x, first.y, first.z)
  assert.equal(res.letter, 'А')
  assert.equal(res.points, LETTER_REWARD)
  assert.deepEqual(res.newlyCompleted, ['letter-А'])
  assert.equal(city.cube.letter, 'Б')
  assert.equal(world.get(city.cube.x, city.cube.y, city.cube.z), B.LETTER)
})

test('breaking any other block does not score', () => {
  const { world, city } = cityWithWorld()
  city.ensureCube()
  assert.equal(city.letterBroken(city.cube.x + 40, city.cube.y, city.cube.z), null)
  assert.equal(world.get(city.cube.x, city.cube.y, city.cube.z), B.LETTER)
})

test('after the last letter no cube is left and no mission is offered', () => {
  const { world, city } = cityWithWorld()
  city.restore(LETTER_IDS.slice(0, -1))
  city.ensureCube()
  assert.equal(city.cube.letter, 'Я')
  world.set(city.cube.x, city.cube.y, city.cube.z, B.AIR)
  city.letterBroken(city.cube.x, city.cube.y, city.cube.z)
  assert.equal(city.cube, null)
  assert.equal(city.status().mission, null)
})

test('startup repairs a cube that the save lost', () => {
  const { world, city } = cityWithWorld()
  world.set(5, 40, 5, B.LETTER)
  city.restoreLetters({ cube: { x: 5, y: 40, z: 5, letter: 'Б', color: '#4dd0ff' } })
  city.restore(['letter-А'])
  city.ensureCube()
  assert.equal(city.cube.letter, 'Б')
  assert.equal(city.cube.color, '#4dd0ff', 'the saved colour survives a restart')
  assert.equal(world.get(city.cube.x, city.cube.y, city.cube.z), B.LETTER)
})

// ------------------------------------------------------------- over the wire

test('check over the wire: the city answer reaches every player', async () => {
  const ctx = await startTestServer({})
  try {
    const a = await TestClient.connect(ctx.url, 'Alice')
    const b = await TestClient.connect(ctx.url, 'Bob')
    assert.equal(a.all(S2C.INIT)[0].city.mission.id, 'letter-А', 'init carries the current mission')

    ctx.server.world.set(10, 40, 10, B.DISPATCH)
    a.send(C2S.CHECK, {})
    const seen = await b.waitFor((m) => m.type === S2C.CITY)
    assert.deepEqual(seen.newlyCompleted, [])
    assert.equal(seen.mission.id, 'letter-А')
    await sleep(10)
  } finally {
    await ctx.server.close()
  }
})

test('break the letter cube over the wire: everyone gets the reward and the points table', async () => {
  const ctx = await startTestServer({ letterHunt: true })
  try {
    const a = await TestClient.connect(ctx.url, 'Alice')
    const b = await TestClient.connect(ctx.url, 'Bob')
    const cube = ctx.server.city.cube
    assert.ok(cube, 'the first letter cube is in the world')
    assert.equal(a.all(S2C.INIT)[0].city.cube.letter, 'А', 'init tells the client where the cube is')
    assert.deepEqual(a.all(S2C.INIT)[0].scores.map((s) => s.score), [0], 'the first player starts at zero')

    await sleep(EDIT_GAP_MS)
    a.send(C2S.BLOCK_EDIT, { seq: 1, ...cube, block: B.AIR, expected: B.LETTER, tool: 1 })
    const seen = await b.waitFor((m) => m.type === S2C.CITY && m.reward)
    assert.deepEqual(seen.reward, { letter: 'А', points: LETTER_REWARD, by: 'Alice' })
    assert.equal(seen.mission.id, 'letter-Б')
    assert.equal(ctx.server.world.get(cube.x, cube.y, cube.z), B.AIR)
    assert.equal(ctx.server.city.cube.letter, 'Б')

    // the points belong to the player who broke the cube, and everyone sees them
    const table = await b.waitFor((m) => m.type === S2C.SCORES && m.scores.some((s) => s.score === LETTER_REWARD))
    assert.equal(table.scores.find((s) => s.name === 'Alice').score, LETTER_REWARD)
    assert.equal(table.scores.find((s) => s.name === 'Bob').score, 0)
  } finally {
    await ctx.server.close()
  }
})
