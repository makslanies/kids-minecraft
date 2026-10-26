// On-screen controls for tablets. Four arrows walk, a round pad turns the view,
// and big buttons break, place and jump. Built only on touch screens, so desktop
// players never see any of it.

/**
 * Show the on-screen controls on every device, for checking on a computer.
 * false: they appear only on touch screens (tablets and phones).
 */
const TOUCH_CONTROLS_ALWAYS = false

/**
 * Whether the on-screen controls are shown. Touch screens get them, including
 * iPads that report a fine pointer when a keyboard is attached. `?touch=1`
 * forces them on, `?touch=0` forces them off.
 */
export function isTouchDevice() {
  const flag = new URLSearchParams(location.search).get('touch')
  if (flag === '1') return true
  if (flag === '0') return false
  if (TOUCH_CONTROLS_ALWAYS) return true
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches
}

function button(id, icon, label, extraClass = '') {
  const btn = document.createElement('button')
  btn.id = id
  btn.className = `act ${extraClass}`.trim()
  btn.type = 'button'
  btn.innerHTML = label
    ? `<span class="icon">${icon}</span><span class="label">${label}</span>`
    : `<span class="icon">${icon}</span>`
  return btn
}

export class TouchControls {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root  the element the controls are added to
   * @param {HTMLElement} opts.canvas  the game view, where drag-to-look happens
   * @param {object} opts.controller  PlayerController: touchMove, touchLook, touchJump, look()
   * @param {() => void} opts.onPlace  tap on the place button
   * @param {() => void} opts.onCheck  tap on the check button
   */
  constructor({ root, canvas, controller, onPlace, onCheck }) {
    this.controller = controller
    /** true while the break button is held down; main.js repeats the break */
    this.breaking = false
    this.held = new Set()

    // --- walking: four arrows, two can be held for a diagonal ---------------
    this.dpad = document.createElement('div')
    this.dpad.id = 'dpad'
    for (const [name, icon] of [['up', '▲'], ['left', '◀'], ['right', '▶'], ['down', '▼']]) {
      const btn = button(`dir-${name}`, icon, '', `dir ${name}`)
      this.dpad.appendChild(btn)
      this._bindHold(btn, () => this._press(name), () => this._release(name))
    }
    root.appendChild(this.dpad)

    // --- view: a round pad, push it to turn ----------------------------------
    this.lookPad = document.createElement('div')
    this.lookPad.id = 'lookpad'
    this.knob = document.createElement('div')
    this.knob.className = 'knob'
    this.lookPad.appendChild(this.knob)
    root.appendChild(this.lookPad)
    this._bindLookPad()

    // --- actions --------------------------------------------------------------
    this.actions = document.createElement('div')
    this.actions.id = 'actions'
    this.breakBtn = button('act-break', '⛏', 'Сломать', 'break')
    this.placeBtn = button('act-place', '🧱', 'Поставить', 'place')
    this.jumpBtn = button('act-jump', '⬆', 'Прыжок', 'jump')
    this.actions.append(this.breakBtn, this.jumpBtn)
    root.append(this.actions, this.placeBtn)

    this.checkBtn = button('act-check', '✔', 'Проверить', 'check')
    root.appendChild(this.checkBtn)

    this._bindHold(this.breakBtn, () => { this.breaking = true }, () => { this.breaking = false })
    this._bindHold(this.jumpBtn, () => { controller.touchJump = true }, () => { controller.touchJump = false })
    this.placeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); onPlace() })
    this.checkBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); onCheck() })

    this._bindLook(canvas)
  }

  _press(name) {
    this.held.add(name)
    this._walk()
  }

  _release(name) {
    this.held.delete(name)
    this._walk()
  }

  /** Turn the four arrows into a walking direction: x right, y forward. */
  _walk() {
    const x = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0)
    const y = (this.held.has('up') ? 1 : 0) - (this.held.has('down') ? 1 : 0)
    const len = Math.hypot(x, y) || 1
    this.controller.touchMove.x = x / len
    this.controller.touchMove.y = y / len
  }

  _bindLookPad() {
    let id = null
    let cx = 0
    let cy = 0
    let radius = 1
    const move = (e) => {
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const len = Math.hypot(dx, dy)
      const k = Math.min(len, radius) / (len || 1)
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`
      // a push up gives a negative screen y, which is a turn up in the controller
      this.controller.touchLook.x = (dx * k) / radius
      this.controller.touchLook.y = (dy * k) / radius
    }
    const release = () => {
      id = null
      this.knob.style.transform = ''
      this.controller.touchLook.x = 0
      this.controller.touchLook.y = 0
    }
    this.lookPad.addEventListener('pointerdown', (e) => {
      if (id !== null) return
      e.preventDefault()
      id = e.pointerId
      this.lookPad.setPointerCapture(id)
      const r = this.lookPad.getBoundingClientRect()
      cx = r.left + r.width / 2
      cy = r.top + r.height / 2
      radius = r.width / 2 - 20
      move(e)
    })
    this.lookPad.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e)
    })
    this.lookPad.addEventListener('pointerup', (e) => {
      if (e.pointerId === id) release()
    })
    this.lookPad.addEventListener('pointercancel', (e) => {
      if (e.pointerId === id) release()
    })
  }

  /** Press-and-hold button: `down` on touch start, `up` when the finger leaves. */
  _bindHold(el, down, up) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      el.classList.add('pressed')
      down()
    })
    const end = () => {
      el.classList.remove('pressed')
      up()
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', end)
  }

  /** One finger that starts on the game view turns the camera while it moves. */
  _bindLook(canvas) {
    let id = null
    let lastX = 0
    let lastY = 0
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || id !== null) return
      id = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
    })
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return
      this.controller.look(e.clientX - lastX, e.clientY - lastY)
      lastX = e.clientX
      lastY = e.clientY
    })
    const end = (e) => {
      if (e.pointerId === id) id = null
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
}
