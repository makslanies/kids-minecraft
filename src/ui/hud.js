// All DOM UI. Plain elements + CSS, no framework.

import { TOOL_PICKAXE, PLACE_BLOCK } from '../../shared/items.js'

const el = (tag, className, html) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (html !== undefined) node.innerHTML = html
  return node
}

export class Hud {
  constructor(root) {
    this.root = root
    this.toastTimer = null

    const ui = el('div')
    ui.id = 'ui'
    root.appendChild(ui)
    this.ui = ui

    this.crosshair = el('div')
    this.crosshair.id = 'crosshair'
    ui.appendChild(this.crosshair)

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
        <p class="sub">Развиваемся вместе, до 8 игроков</p>
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
            <tr><td><kbd>Esc</kbd></td><td>Выйти из игры</td></tr>
          </table>
        </div>
        <div class="keys touch-help">
          <p>Стрелки слева внизу — ходить. Круг справа внизу — смотреть по сторонам.</p>
          <p>Посередине — сломать, поставить и прыгнуть.</p>
        </div>
        <section class="parents">
          <h2>Для родителей</h2>
          <p>Ребёнок строит свой город: ставит маяки, сирены и датчики и ищет спрятанные золотые кубики с буквами русского алфавита. Каждая найденная буква приносит очки.</p>
          <p>В игре нет боя, чата и чужих игроков. Животные не получают урона. Вход защищён паролем, и играть можно без регистрации.</p>
        </section>
      </div>`
    root.appendChild(this.overlay)

    this.nameInput = this.overlay.querySelector('#name-input')
    this.joinBtn = this.overlay.querySelector('#join-btn')
    this.overlayStatus = this.overlay.querySelector('#overlay-status')

  }

  /** The tool that breaks blocks. Only the pickaxe is in hand now. */
  get selectedTool() {
    return TOOL_PICKAXE
  }

  /** Placing always uses the same block; there is no block picker. */
  get selectedBlock() {
    return PLACE_BLOCK
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
