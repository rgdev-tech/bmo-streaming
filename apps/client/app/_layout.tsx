import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs'
import { StatusBar } from 'expo-status-bar'

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <Icon sf="house.fill" />
          <Label>Inicio</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="search" role="search">
          <Icon sf="magnifyingglass" />
          <Label>Buscar</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="library">
          <Icon sf="bookmark.fill" />
          <Label>Biblioteca</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </>
  )
}
