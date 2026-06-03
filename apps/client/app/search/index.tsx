import { Stack } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View, Text, StyleSheet } from 'react-native'

export default function SearchScreen() {
  const [query, setQuery] = useState('')

  return (
    <>
      <Stack.Screen
        options={{
          headerLargeTitle: true,
          title: 'Buscar',
          headerSearchBarOptions: {
            placeholder: 'Películas, series, actores...',
            barTintColor: '#1C1C1E',
            textColor: '#fff',
            tintColor: '#fff',
            hintTextColor: 'rgba(255,255,255,0.4)',
            headerIconColor: '#fff',
            hideWhenScrolling: false,
            autoFocus: true,
            onChangeText: (e) => setQuery(e.nativeEvent.text),
          },
        }}
      />
      <ScrollView
        style={styles.container}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.body}>
          {query.length === 0 ? (
            <Text style={styles.hint}>Busca tus películas y series</Text>
          ) : (
            <Text style={styles.hint}>Buscando: {query}</Text>
          )}
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  body: {
    paddingTop: 120,
    alignItems: 'center',
  },
  hint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
  },
})
