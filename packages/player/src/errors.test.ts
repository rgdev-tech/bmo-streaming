import { describe, expect, test } from 'bun:test'
import { describePlaybackError } from './errors'

// Los `raw` de acá son los que realmente produce el sistema: el cliente HTTP de
// @bmo/core/api arma "API <status> en <path>", y los motores de video largan los
// dominios de error de Apple/VLC.
describe('describePlaybackError', () => {
  test('404 del resolver: no es un fallo de la app, es que no hay fuente', () => {
    const e = describePlaybackError('API 404 en /resolve/movie/550')
    expect(e.title).toBe('No encontramos ninguna fuente')
    expect(e.detail).not.toContain('404')
    expect(e.detail).not.toContain('/resolve')
  })

  test('429 y 5xx se distinguen entre sí', () => {
    expect(describePlaybackError('API 429 en /resolve/movie/1').title)
      .toBe('Demasiados intentos seguidos')
    expect(describePlaybackError('API 503 en /resolve/movie/1').title)
      .toBe('El servidor tuvo un problema')
  })

  test('fallo de la calidad elegida a mano: no se agotó nada, quedan otras', () => {
    const e = describePlaybackError('No se pudo abrir esa fuente')
    expect(e.title).toBe('Esa calidad no se pudo abrir')
    expect(e.detail).toContain('siguen disponibles')
  })

  test('timeout del resolve', () => {
    expect(describePlaybackError('Aborted').title).toBe('La búsqueda tardó demasiado')
    expect(describePlaybackError('The operation timed out').title).toBe('La búsqueda tardó demasiado')
  })

  test('sin red', () => {
    expect(describePlaybackError('Network request failed').title).toBe('Sin conexión')
  })

  test('error del motor de video tras agotar el fallback', () => {
    const e = describePlaybackError('The operation could not be completed. (CoreMediaErrorDomain error -12642.)')
    expect(e.title).toBe('Ninguna fuente se pudo reproducir')
    expect(e.detail).toContain('otra calidad')
  })

  test('lo que no se reconoce se muestra tal cual, sin inventar una causa', () => {
    const e = describePlaybackError('algo rarísimo pasó')
    expect(e.title).toBe('No se pudo reproducir')
    expect(e.detail).toBe('algo rarísimo pasó')
  })

  test('vacío o null no rompe', () => {
    expect(describePlaybackError(null).title).toBe('No se pudo reproducir')
    expect(describePlaybackError('   ').detail).toBe('No hay más detalle disponible.')
  })

  test('un 404 que no viene del cliente HTTP no se confunde con el del resolver', () => {
    // "404" suelto en un mensaje de otra cosa no debería disparar el copy del
    // resolver — de ahí que el patrón exija el prefijo "API".
    expect(describePlaybackError('VLC: stream 404 chunks perdidos').title)
      .toBe('Ninguna fuente se pudo reproducir')
  })
})
