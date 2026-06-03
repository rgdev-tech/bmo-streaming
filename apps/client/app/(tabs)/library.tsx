import { useCallback, useState } from 'react'
import {
  ScrollView,
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  getMyList,
  getContinueWatching,
  type LibraryItem,
  type Progress,
} from '@/lib/library'
import { PosterCard } from '@/components/PosterCard'
import { ContinueCard } from '@/components/ContinueCard'
import type { MediaItem } from '@/lib/tmdb'

const GRID_GAP = 12
const GRID_PAD = 20
const GRID_CARD = Math.floor(
  (Dimensions.get('window').width - GRID_PAD * 2 - GRID_GAP * 2) / 3
)

export default function LibraryScreen() {
  const [list, setList] = useState<LibraryItem[]>([])
  const [watching, setWatching] = useState<Progress[]>([])

  useFocusEffect(
    useCallback(() => {
      getMyList().then(setList)
      getContinueWatching().then(setWatching)
    }, [])
  )

  const empty = list.length === 0 && watching.length === 0

  return (
    <ScrollView style={styles.container} contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.title}>Biblioteca</Text>

      {empty && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Aquí aparecerá lo que guardes en Mi Lista y lo que estés viendo.
          </Text>
        </View>
      )}

      {watching.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.heading}>Seguir viendo</Text>
          <FlatList
            horizontal
            data={watching}
            keyExtractor={(i) => `${i.media_type}-${i.id}`}
            renderItem={({ item }) => <ContinueCard item={item} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          />
        </View>
      )}

      {list.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.heading}>Mi Lista</Text>
          <View style={styles.grid}>
            {list.map((item) => (
              <PosterCard
                key={`${item.media_type}-${item.id}`}
                item={item as MediaItem}
                width={GRID_CARD}
              />
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  emptyBox: { paddingHorizontal: 24, paddingTop: 80, alignItems: 'center' },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  section: { marginTop: 24 },
  heading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  row: { paddingHorizontal: 20 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GRID_PAD,
  },
})
