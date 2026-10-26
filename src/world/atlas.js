// Block texture atlas: 16x16 tiles on a 4x4 sheet, built offline by
// tools/build-atlas.py from the CC0 textures in assets/textures/.
//
// The texture is returned right away and `ready` resolves once the image has
// loaded, so anything that needs the pixels (the HUD thumbnails) waits for it.

import * as THREE from 'three'
import atlasUrl from '../assets/blocks-atlas.png'

export function createAtlas() {
  let markReady
  const ready = new Promise((resolve) => { markReady = resolve })

  const tex = new THREE.TextureLoader().load(atlasUrl, () => markReady())
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  // Our UVs put v=row/4 with row 0 = image top, so keep the image unflipped.
  tex.flipY = false
  tex.ready = ready
  return tex
}
