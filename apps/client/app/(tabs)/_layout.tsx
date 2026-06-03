import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs'

export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf="house.fill" />
        <Label>Inicio</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="series">
        <Icon sf="tv" />
        <Label>Series</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="peliculas">
        <Icon sf="film" />
        <Label>Películas</Label>
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
  )
}
