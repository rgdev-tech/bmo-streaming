import { View, Text, FlatList, StyleSheet } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { ContinueCard } from './ContinueCard'
import { Touchable } from './Touchable'
import { rowHeading } from '@/lib/typography'
import type { Progress } from '@/lib/library'
import { rowVirtualization, fixedItemLayout } from './rowVirtualization'

// 300 de la tarjeta + 12 de separación (ver ContinueCard).
const CONTINUE_ITEM_W = 300 + 12

export function ContinueRow({
  items,
  onChange,
  onSeeAll,
}: {
  items: Progress[]
  onChange?: () => void
  onSeeAll?: () => void
}) {
  if (!items.length) return null

  return (
    <View style={styles.section}>
      <Touchable
        style={styles.headingRow}
        scaleTo={0.98}
        haptic="light"
        onPress={onSeeAll}
        disabled={!onSeeAll}
      >
        <Text style={styles.heading}>Seguir viendo</Text>
        {onSeeAll && (
          <SymbolView name="chevron.right" tintColor="#fff" style={styles.chevron} />
        )}
      </Touchable>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(i) => `${i.media_type}-${i.id}`}
        renderItem={({ item }) => <ContinueCard item={item} onRemove={onChange} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        getItemLayout={fixedItemLayout(CONTINUE_ITEM_W)}
        {...rowVirtualization}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // 30 para igualar el ritmo del resto de secciones (ver library.tsx).
  section: { marginBottom: 30 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  heading: rowHeading,
  chevron: { width: 18, height: 18, marginTop: 2 },
  row: { paddingHorizontal: 20 },
})
