// The install metadata: the manifest names the game and its icons exist on disk.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))

test('manifest opens the game fullscreen in Russian with its icons', async () => {
  const m = JSON.parse(await readFile(`${publicDir}manifest.webmanifest`, 'utf8'))
  assert.equal(m.name, 'Мой безопасный город')
  assert.equal(m.lang, 'ru')
  assert.equal(m.start_url, '/')
  assert.equal(m.display, 'fullscreen')
  for (const icon of m.icons) {
    await access(`${publicDir}${icon.src}`)
  }
  assert.ok(m.icons.some((i) => i.sizes === '512x512'), 'a 512 px icon is present')
})

test('the service worker is in the public folder, so it is served at the site root', async () => {
  await access(`${publicDir}sw.js`)
})
