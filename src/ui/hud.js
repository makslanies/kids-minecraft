// All DOM UI. Plain elements + CSS, no framework.

import { BLOCKS, ATLAS_COLS, tileFor } from '../../shared/blocks.js'
import { HOTBAR, TOOL_BY_ID, toolSpeedOn, FAMILY } from '../../shared/items.js'

const el = (tag, className, html) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (html !== undefined) node.innerHTML = html
  return node
}

/**
 * Tool icons, drawn to fill a 64x64 canvas so they read at 32px in the hotbar
 * instead of turning into hairlines.
 */
const STEEL = '#d7dde6'
const STEEL_DARK = '#9aa3b0'
const WOOD = '#a87c4e'
const WOOD_DARK = '#7a5732'

const TOOL_ICONS = {
  pickaxe: (ctx) => {
    ctx.strokeStyle = WOOD
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(12, 52)
    ctx.lineTo(38, 24)
    ctx.stroke()
    ctx.strokeStyle = STEEL
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(20, 12)
    ctx.quadraticCurveTo(44, 10, 54, 30)
    ctx.stroke()
    ctx.strokeStyle = STEEL_DARK
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(26, 13)
    ctx.quadraticCurveTo(44, 13, 51, 27)
    ctx.stroke()
    ctx.fillStyle = WOOD_DARK
    ctx.beginPath()
    ctx.arc(11, 53, 5, 0, Math.PI * 2)
    ctx.fill()
  },
  axe: (ctx) => {
    ctx.strokeStyle = WOOD
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(18, 54)
    ctx.lineTo(30, 26)
    ctx.stroke()
    ctx.fillStyle = STEEL
    ctx.beginPath()
    ctx.moveTo(26, 6)
    ctx.lineTo(54, 14)
    ctx.lineTo(48, 34)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = STEEL_DARK
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(30, 9)
    ctx.lineTo(50, 15)
    ctx.stroke()
  },
  shovel: (ctx) => {
    ctx.strokeStyle = WOOD
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(32, 22)
    ctx.lineTo(32, 54)
    ctx.stroke()
    ctx.fillStyle = STEEL
    ctx.beginPath()
    ctx.moveTo(18, 4)
    ctx.lineTo(46, 4)
    ctx.lineTo(38, 24)
    ctx.lineTo(26, 24)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = STEEL_DARK
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(22, 8)
    ctx.lineTo(42, 8)
    ctx.stroke()
  },
}

function toolIcon(name) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  TOOL_ICONS[name]?.(ctx)
  return canvas
}

export class Hud {
  constructor(root) {
    this.root = root
    this.selected = 0
    this.toastTimer = null

    const ui = el('div')
    ui.id = 'ui'
    root.appendChild(ui)
    this.ui = ui

    this.crosshair = el('div')
    this.crosshair.id = 'crosshair'
    ui.appendChild(this.crosshair)

    // --- hotbar ------------------------------------------------------------
    this.hotbar = el('div')
    this.hotbar.id = 'hotbar'
    ui.appendChild(this.hotbar)
    this.slots = HOTBAR.map((item, i) => {
      const slot = el('div', `slot ${item.kind === 'tool' ? 'tool' : ''}`)
      slot.appendChild(el('span', 'num', String(i + 1)))
      if (item.kind === 'tool') {
        const icon = toolIcon(TOOL_BY_ID.get(item.id).key)
        slot.appendChild(icon)
      } else {
        slot.appendChild(el('canvas'))
      }
      slot.appendChild(el('span', 'name', item.kind === 'tool'
        ? TOOL_BY_ID.get(item.id).name
        : BLOCKS[item.id].name))
      slot.addEventListener('click', () => this.select(i))
      this.hotbar.appendChild(slot)
      return slot
    })

    // --- break swing feedback ----------------------------------------------
    this.swingBar = el('div')
    this.swingBar.id = 'swing'
    ui.appendChild(this.swingBar)

    // --- points of every player, top right ---------------------------------
    this.score = el('div', 'panel')
    this.score.id = 'score'
    ui.appendChild(this.score)


    // --- mission sheet: a curtain that slides up from the bottom edge -----
    this.sheet = el('div')
    this.sheet.id = 'sheet'
    this.sheet.innerHTML = `
      <div class="grip"></div>
      <h2></h2>
      <p></p>
      <button type="button" class="primary">Понятно!</button>`
    this.sheetTitle = this.sheet.querySelector('h2')
    this.sheetHint = this.sheet.querySelector('p')
    this.sheet.querySelector('button').addEventListener('click', () => this.hideSheet())
    ui.appendChild(this.sheet)
    this.shownMissionId = null
    // swipe the grip down to close, like a real curtain
    let swipeFrom = null
    this.sheet.querySelector('.grip').addEventListener('pointerdown', (e) => { swipeFrom = e.clientY })
    window.addEventListener('pointerup', (e) => {
      if (swipeFrom !== null && e.clientY - swipeFrom > 40) this.hideSheet()
      swipeFrom = null
    })

    this.toastEl = el('div')
    this.toastEl.id = 'toast'
    ui.appendChild(this.toastEl)

    this.hint = el('div')
    this.hint.id = 'hint'
    ui.appendChild(this.hint)

    this.targetInfo = el('div')
    this.targetInfo.id = 'target-info'
    ui.appendChild(this.targetInfo)

    // --- join overlay ------------------------------------------------------
    this.overlay = el('div')
    this.overlay.id = 'overlay'
    this.overlay.innerHTML = `
      <div class="card">
        <h1>Мой безопасный город</h1>
        <p class="sub">Строим вместе, до 8 игроков</p>
        <div class="field">
          <input id="name-input" maxlength="16" placeholder="Твоё имя" autocomplete="off" />
          <button class="primary" id="join-btn" disabled>Подключение…</button>
        </div>
        <div class="actions" id="overlay-status"></div>
        <div class="keys">
          <table>
            <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Ходить</td></tr>
            <tr><td><kbd>Space</kbd></td><td>Прыжок</td></tr>
            <tr><td><kbd>Shift</kbd></td><td>Бежать</td></tr>
            <tr><td>Левая кнопка</td><td>Сломать блок</td></tr>
            <tr><td>Правая кнопка</td><td>Поставить блок</td></tr>
            <tr><td><kbd>1</kbd>&ndash;<kbd>8</kbd> / wheel</td><td>Выбрать инструмент или блок</td></tr>
            <tr><td><kbd>C</kbd></td><td>Проверить город</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Выйти из игры</td></tr>
          </table>
        </div>
        <div class="keys touch-help">
          <p>Слева пальцем — ходить. Справа — сломать, поставить и прыгнуть.</p>
          <p>Чтобы посмотреть по сторонам, проведи пальцем по экрану. Проверка города — кнопка ✔.</p>
        </div>
      </div>`
    root.appendChild(this.overlay)

    this.nameInput = this.overlay.querySelector('#name-input')
    this.joinBtn = this.overlay.querySelector('#join-btn')
    this.overlayStatus = this.overlay.querySelector('#overlay-status')

    this.onSelect = null
    this.select(0)
  }

  /** 32x32 block swatch cropped straight out of the runtime atlas. */
  swatch(id, atlasImage) {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    if (atlasImage) {
      const tile = tileFor(id, 'side')
      const col = tile % ATLAS_COLS
      const row = Math.floor(tile / ATLAS_COLS)
      ctx.drawImage(atlasImage, col * 16, row * 16, 16, 16, 0, 0, 32, 32)
    } else {
      ctx.fillStyle = '#3d444d'
      ctx.fillRect(0, 0, 32, 32)
    }
    return canvas
  }

  /** Re-draw the block swatches once the atlas exists. */
  attachAtlas(atlasImage) {
    this.slots.forEach((slot, i) => {
      const item = HOTBAR[i]
      if (item.kind !== 'block') return
      const old = slot.querySelector('canvas')
      if (old) slot.replaceChild(this.swatch(item.id, atlasImage), old)
    })
  }

  select(index) {
    this.selected = ((index % HOTBAR.length) + HOTBAR.length) % HOTBAR.length
    this.slots.forEach((s, i) => s.classList.toggle('active', i === this.selected))
    const item = HOTBAR[this.selected]
    this.onSelect?.(item)
    return item
  }

  get selectedItem() {
    return HOTBAR[this.selected]
  }

  get selectedTool() {
    const item = HOTBAR[this.selected]
    return item.kind === 'tool' ? item.id : 0
  }

  get selectedBlock() {
    const item = HOTBAR[this.selected]
    return item.kind === 'block' ? item.id : 0
  }

  cycle(delta) {
    return this.select(this.selected + delta)
  }

  setHint(text) {
    this.hint.textContent = text || ''
    this.hint.style.display = text ? '' : 'none'
  }

  /**
   * Slide the curtain up with the current mission. Shown once per mission, so
   * closing it stays closed until the next mission starts.
   */
  offerMission(mission) {
    if (!mission || mission.id === this.shownMissionId) return
    this.shownMissionId = mission.id
    this.sheetTitle.textContent = mission.title
    this.sheetHint.textContent = mission.hint
    this.sheet.classList.add('open')
  }

  hideSheet() {
    this.sheet.classList.remove('open')
  }

  setSwing(progress) {
    if (progress <= 0) {
      this.swingBar.style.opacity = '0'
      return
    }
    this.swingBar.style.opacity = '1'
    this.swingBar.style.transform = `translateX(-50%) scaleX(${Math.min(1, progress)})`
  }

  /** Small label under the crosshair when a tool speeds this block up. */
  setTargetInfo(text) {
    if (this._targetText === text) return
    this._targetText = text
    this.targetInfo.textContent = text || ''
  }

  toast(text, kind = 'error') {
    this.toastEl.textContent = text
    this.toastEl.className = kind
    this.toastEl.classList.add('show')
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2600)
  }

  setStatus(state) {
    const labels = {
      idle: 'idle',
      connecting: 'connecting to the server…',
      connected: 'connected — pick a name and join',
      reconnecting: 'connection lost, retrying…',
      closed: 'disconnected',
    }
    this.overlayStatus.innerHTML = `<span style="color:#8b98a8">${labels[state] || state}</span>`
  }

  showOverlay(show) {
    this.overlay.classList.toggle('hidden', !show)
  }

  setJoinEnabled(enabled, label) {
    this.joinBtn.disabled = !enabled
    this.joinBtn.textContent = label || (enabled ? 'Играть' : 'Подключение…')
  }

  /** Points table: everyone's name and score, best first. */
  setScores(list, selfId) {
    const rows = list
      .slice()
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .map((p) => {
        const me = p.id === selfId ? ' me' : ''
        return `<div class="row${me}"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}<span class="pts">${p.score}</span></div>`
      })
      .join('')
    this.score.innerHTML = `<h3>⭐ Очки</h3>${rows || '<div class="row">пока никто не нашёл букву</div>'}`
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
