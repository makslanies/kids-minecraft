// A big floating letter above the golden letter cube, so a child can read it
// from across the plaza. The cube itself is an ordinary block in the world.

import * as THREE from 'three'

function letterMaterial(letter, color) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.font = 'bold 104px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 14
  ctx.strokeStyle = '#2b1d00'
  ctx.strokeText(letter, 64, 70)
  ctx.fillStyle = color
  ctx.fillText(letter, 64, 70)
  const map = new THREE.CanvasTexture(canvas)
  // drawn through hills and trees: the letter is a signpost, not scenery
  return new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false })
}

export class LetterSign {
  constructor(scene) {
    this.scene = scene
    this.sprite = null
    this.key = null
  }

  /** @param {{x:number,y:number,z:number,letter:string,color:string}|null} cube */
  sync(cube) {
    const key = cube ? `${cube.x},${cube.y},${cube.z},${cube.letter},${cube.color}` : null
    if (key === this.key) return
    this.key = key
    if (this.sprite) {
      this.scene.remove(this.sprite)
      this.sprite.material.map.dispose()
      this.sprite.material.dispose()
      this.sprite = null
    }
    if (!cube) return
    this.sprite = new THREE.Sprite(letterMaterial(cube.letter, cube.color))
    this.sprite.renderOrder = 10
    this.sprite.position.set(cube.x + 0.5, cube.y + 1.6, cube.z + 0.5)
    this.sprite.scale.set(2.4, 2.4, 1)
    this.scene.add(this.sprite)
  }
}
