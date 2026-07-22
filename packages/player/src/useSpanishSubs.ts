import { useEffect, useState } from 'react'
import type { ResolveInfo, Subtitle } from '@bmo/core/stream'
import { parseSrt, decodeSrtBytes, type SrtCue } from '@bmo/core/srt'

// Estrategia de descarga+parseo del subtítulo español. El default lee los bytes
// EN MEMORIA (sin escribir a disco) — lo usa la TV, que no tiene
// expo-file-system. El client inyecta una variante que además cachea a disco.
export type SpanishSubsFetcher = (subs: Subtitle[]) => Promise<SrtCue[]>

// Baja el subtítulo español y lo parsea en memoria. Se lee como bytes crudos y
// se decodifica con decodeSrtBytes para no romper acentos cuando el .srt viene
// en latin1. Un .srt real nunca es text/html; una página de bloqueo de
// Cloudflare sí → se descarta.
export const fetchSpanishSubsInMemory: SpanishSubsFetcher = async (subs) => {
  const esSubs = subs.filter((s) => s.lang === 'es')
  for (const s of esSubs) {
    for (const url of [s.url, ...(s.altUrls ?? [])]) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const ct = res.headers.get('content-type') ?? ''
        if (/text\/html/i.test(ct)) continue
        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const cues = parseSrt(decodeSrtBytes(binary))
        if (cues.length) return cues
      } catch {
        // siguiente url
      }
    }
  }
  return []
}

export type SpanishSubsOptions = {
  // Estrategia de descarga (default: en memoria). El client pasa la de disco.
  fetcher?: SpanishSubsFetcher
  // Para qué fuentes bajar el overlay español. Default: solo 'file' (las 'hls'
  // ya traen sus pistas proxeadas por el API).
  enabledFor?: (info: ResolveInfo) => boolean
}

/**
 * Descarga en paralelo (sin bloquear el arranque) el subtítulo español y lo
 * devuelve como cues listas para el overlay JS. Se re-baja por fuente (cada
 * `info` nuevo trae sus propios subtítulos). Compartido entre client y tv; la
 * única diferencia (caché a disco vs memoria) va por `fetcher`.
 */
export function useSpanishSubs(info: ResolveInfo | null, opts: SpanishSubsOptions = {}): SrtCue[] {
  const { fetcher = fetchSpanishSubsInMemory, enabledFor = (i) => i.type === 'file' } = opts
  const [cues, setCues] = useState<SrtCue[]>([])

  useEffect(() => {
    if (!info || !enabledFor(info)) { setCues([]); return }
    let cancelled = false
    fetcher(info.subtitles ?? [])
      .then((c) => { if (!cancelled) setCues(c) })
      .catch(() => {})
    return () => { cancelled = true }
    // enabledFor/fetcher son estables por app; deps sobre `info` a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  return cues
}
