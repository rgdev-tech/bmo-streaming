import { Tabs } from 'expo-router'
import { Platform } from 'react-native'
import { BlurView } from 'expo-blur'
import { StatusBar } from 'expo-status-bar'
import { SymbolView } from 'expo-symbols'

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#FFFFFF',
          tabBarInactiveTintColor: 'rgba(255,255,255,0.4)',
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
          },
          tabBarBackground: () => (
            <BlurView
              intensity={80}
              tint="systemChromeMaterialDark"
              style={{ flex: 1 }}
            />
          ),
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Inicio',
            tabBarIcon: ({ color }) => (
              <SymbolView
                name="house.fill"
                tintColor={color}
                style={{ width: 24, height: 24 }}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'Buscar',
            tabBarIcon: ({ color }) => (
              <SymbolView
                name="magnifyingglass"
                tintColor={color}
                style={{ width: 24, height: 24 }}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: 'Biblioteca',
            tabBarIcon: ({ color }) => (
              <SymbolView
                name="bookmark.fill"
                tintColor={color}
                style={{ width: 24, height: 24 }}
              />
            ),
          }}
        />
      </Tabs>
    </>
  )
}
