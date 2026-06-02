import { View, Text, StyleSheet, ScrollView } from 'react-native'

export default function HomeScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.hero}>
        <Text style={styles.logo}>BMO</Text>
        <Text style={styles.tagline}>Tu streaming, sin ruido.</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  hero: {
    paddingTop: 120,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  logo: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
  },
})
