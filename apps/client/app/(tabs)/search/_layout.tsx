import { Stack } from 'expo-router'

export default function SearchLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTransparent: true,
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: '#fff',
        headerTitleStyle: { color: '#fff' },
        headerShadowVisible: false,
      }}
    />
  )
}
