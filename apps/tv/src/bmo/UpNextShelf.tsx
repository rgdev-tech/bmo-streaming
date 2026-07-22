import { memo, useEffect, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { colors, layout, safe } from './theme'

// Una tarjeta de la repisa. La imagen es un still 16:9 (episodio) o un póster 2:3
// (película relacionada); `aspect` define la forma. `onSelect` reproduce ese
// título. `active` marca el que se está viendo ahora (episodio actual).
export type ShelfItem = {
  key: string
  image: string | null
  label: string
  sublabel?: string
  aspect: 'still' | 'poster'
  active?: boolean
  onSelect: () => void
}

const STILL_W = 248
const STILL_H = 140 // 16:9
const POSTER_W = 122
const POSTER_H = 183 // 2:3
const GAP = 16

function ShelfCard({
  item,
  index,
  firstFocus,
  onFocusCard,
  onPress,
}: {
  item: ShelfItem
  index: number
  firstFocus: boolean
  onFocusCard: (index: number) => void
  onPress: () => void
}) {
  const w = item.aspect === 'still' ? STILL_W : POSTER_W
  const h = item.aspect === 'still' ? STILL_H : POSTER_H
  return (
    <Pressable
      hasTVPreferredFocus={firstFocus}
      onFocus={() => onFocusCard(index)}
      onPress={onPress}
      style={{ width: w }}
    >
      {({ focused }) => (
        <View>
          <View style={[styles.thumbWrap, { width: w, height: h }, focused && styles.thumbWrapFocused]}>
            {item.image ? (
              <Image
                source={item.image}
                style={{ width: w, height: h }}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
                recyclingKey={item.key}
              />
            ) : (
              <View style={[styles.thumbEmpty, { width: w, height: h }]}>
                <Text style={styles.thumbEmptyText} numberOfLines={2}>{item.label}</Text>
              </View>
            )}
            {item.active && (
              <View style={styles.nowBadge}>
                <Text style={styles.nowBadgeText}>Viendo</Text>
              </View>
            )}
          </View>
          <Text style={[styles.cardLabel, { width: w }, focused && styles.cardLabelFocused]} numberOfLines={1}>
            {item.label}
          </Text>
          {!!item.sublabel && (
            <Text style={[styles.cardSub, { width: w }]} numberOfLines={1}>{item.sublabel}</Text>
          )}
        </View>
      )}
    </Pressable>
  )
}

/**
 * Repisa "A continuación", anclada al pie del reproductor. Se abre con la flecha
 * ABAJO desde el HUD: en una serie lista los episodios de la temporada; en una
 * película, títulos relacionados (secuelas + afines). Fila horizontal enfocable
 * con scroll-al-foco; Atrás la cierra (lo maneja el motor del player).
 */
export const UpNextShelf = memo(function UpNextShelf({
  title,
  items,
  initialFocus = 0,
  onClose,
}: {
  title: string
  items: ShelfItem[]
  // Índice que recibe el foco al abrir (p. ej. el episodio actual).
  initialFocus?: number
  // Se llama tras elegir un título (además de item.onSelect) para cerrar la repisa.
  onClose?: () => void
}) {
  const scrollRef = useRef<ScrollView>(null)
  const stepW = (items[0]?.aspect === 'poster' ? POSTER_W : STILL_W) + GAP

  const scrollToCard = (index: number) => {
    // Deja la tarjeta enfocada con un poco de aire a la izquierda, para que se
    // vea que hay más a los costados (como una fila de catálogo).
    const x = Math.max(0, index * stepW - safe.horizontal)
    scrollRef.current?.scrollTo({ x, animated: true })
  }

  // Posiciona la tarjeta inicial (episodio actual) en vista al abrir, sin animar,
  // así no se ve el salto que haría el evento de foco al llegar tarde.
  useEffect(() => {
    if (initialFocus <= 0) return
    const x = Math.max(0, initialFocus * stepW - safe.horizontal)
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ x, animated: false }))
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View style={styles.root} pointerEvents="box-none">
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.96)']}
        style={styles.scrim}
        pointerEvents="none"
      />
      <Text style={styles.heading}>{title}</Text>
      <TVFocusGuideView trapFocusLeft trapFocusRight>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {items.map((item, i) => (
            <ShelfCard
              key={item.key}
              item={item}
              index={i}
              firstFocus={i === initialFocus}
              onFocusCard={scrollToCard}
              onPress={() => { item.onSelect(); onClose?.() }}
            />
          ))}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  )
})

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: safe.bottom,
    paddingTop: 24,
  },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, top: -40 },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: safe.horizontal,
    marginBottom: 12,
  },
  row: { paddingHorizontal: safe.horizontal, gap: GAP },
  thumbWrap: {
    borderRadius: layout.radius,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbWrapFocused: { borderColor: colors.focusBorder },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  thumbEmptyText: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
  nowBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  nowBadgeText: { color: '#000', fontSize: 11, fontWeight: '800' },
  cardLabel: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 8 },
  cardLabelFocused: { color: '#fff' },
  cardSub: { color: colors.textDim, fontSize: 11, marginTop: 2 },
})
