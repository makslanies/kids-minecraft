// Missions for the kids' city. Letter missions are done by breaking the
// letter cube; completed missions stay completed.

import { B } from './blocks.js'

/** Points for each letter cube the player breaks. */
export const LETTER_REWARD = 10

/** Colours a letter can have. Bright enough to read on grass and sky. */
export const LETTER_COLORS = ['#ff5c5c', '#ff9f43', '#ffe14d', '#7ee787', '#4dd0ff', '#8b7bff', '#ff7ad9', '#ffffff']

/** The whole Russian alphabet, in order. */
export const LETTERS = [
  'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П',
  'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
]

/** Letter hunt: find the golden cube with the letter and break it. */
const LETTER_MISSIONS = LETTERS.map((letter) => ({
  id: `letter-${letter}`,
  title: `Найди букву ${letter}`,
  hint: `Найди золотой кубик с буквой ${letter} и сломай его`,
  goal: { type: 'letter', letter },
}))

export const MISSIONS = [...LETTER_MISSIONS]

/** @returns {boolean} whether one mission's goal holds for the current city */
export function isMet(mission, { counts, lit }) {
  const g = mission.goal
  if (g.type === 'device') return (counts[g.block] || 0) >= g.count
  if (g.type === 'lit') return lit[g.district] === true
  // letter missions are done by breaking the cube, not by "Проверить город"
  return false
}

/** @returns {object|null} the first mission not yet completed */
export function currentMission(completed) {
  return MISSIONS.find((m) => !completed.includes(m.id)) || null
}
