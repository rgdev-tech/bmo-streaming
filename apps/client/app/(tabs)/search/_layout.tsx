import { Stack } from 'expo-router'

export default function SearchLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#000' },
        headerTintColor: '#fff',
        headerLargeTitleStyle: { color: '#fff' },
        contentStyle: { backgroundColor: '#000' },
      }}
    />
  )
}
