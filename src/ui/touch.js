// On-screen controls for tablets. Stick on the left, big buttons on the right,
// and a drag anywhere on the game view turns the camera. Built only on touch
// screens, so desktop players never see any of it.

const STICK_RADIUS = 70
const LOOK_SPEED = 1

/** Touch screen, including iPads that report a fine pointer when a keyboard is attached. */
export function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches
}

function button(id, icon, label, extraClass = '') {
  const btn = document.createElement('button')
  btn.id = id
  btn.className = `act ${extraClass}`.trim()
  btn.type = 'button'
  btn.innerHTML = `<span class="icon">${icon}</span><span class="label">${label}</span>`
  return btn
}

export class TouchControls {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root  the element the controls are added to
   * @param {HTMLElement} opts.canvas  the game view, where drag-to-look happens
   * @param {object} opts.controller  PlayerController: touchMove, touchJump, look()
   * @param {() => void} opts.onPlace  tap on the place button
   * @param {() => void} opts.onCheck  tap on the check button
   */
  constructor({ root, canvas, controller, onPlace, onCheck }) {
    this.controller = controller
    /** true while the break button is held down; main.js repeats the break */
    this.breaking = false

    this.stick = document.createElement('div')
    this.stick.id = 'stick'
    this.knob = document.createElement('div')
    this.knob.className = 'knob'
    this.stick.appendChild(this.knob)
    root.appendChild(this.stick)

    this.actions = document.createElement('div')
    this.actions.id = 'actions'
    this.breakBtn = button('act-break', '⛏', 'Сломать', 'break')
    this.placeBtn = button('act-place', '🧱', 'Поставить', 'place')
    this.jumpBtn = button('act-jump', '⬆', 'Прыжок', 'jump')
    this.actions.append(this.breakBtn, this.placeBtn, this.jumpBtn)
    root.appendChild(this.actions)

    this.checkBtn = button('act-check', '✔', 'Проверить город', 'check')
    root.appendChild(this.checkBtn)

    this._bindStick()
    this._bindHold(this.breakBtn, () => { this.breaking = true }, () => { this.breaking = false })
    this._bindHold(this.jumpBtn, () => { controller.touchJump = true }, () => { controller.touchJump = false })
    this.placeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); onPlace() })
    this.checkBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); onCheck() })

    this._bindLook(canvas)
  }

  _bindStick() {
    let id = null
    let cx = 0
    let cy = 0
    const move = (e) => {
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const len = Math.hypot(dx, dy)
      const k = Math.min(len, STICK_RADIUS) / (len || 1)
      const kx = dx * k
      const ky = dy * k
      this.knob.style.transform = `translate(${kx}px, ${ky}px)`
      // screen y grows downwards, forward is up
      this.controller.touchMove.x = kx / STICK_RADIUS
      this.controller.touchMove.y = -ky / STICK_RADIUS
    }
    const release = () => {
      id = null
      this.knob.style.transform = ''
      this.controller.touchMove.x = 0
      this.controller.touchMove.y = 0
    }
    this.stick.addEventListener('pointerdown', (e) => {
      if (id !== null) return
      e.preventDefault()
      id = e.pointerId
      this.stick.setPointerCapture(id)
      const r = this.stick.getBoundingClientRect()
      cx = r.left + r.width / 2
      cy = r.top + r.height / 2
      move(e)
    })
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e)
    })
    this.stick.addEventListener('pointerup', (e) => {
      if (e.pointerId === id) release()
    })
    this.stick.addEventListener('pointercancel', (e) => {
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
      this.controller.look((e.clientX - lastX) * LOOK_SPEED, (e.clientY - lastY) * LOOK_SPEED)
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
