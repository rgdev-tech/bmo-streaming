module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 corre las animaciones en el hilo de UI mediante worklets; el
    // plugin es el que compila esas funciones para que puedan cruzar de hilo.
    // Desde la v4 vive en react-native-worklets, no en react-native-reanimated.
    // Va SIEMPRE último si en algún momento se agregan más plugins.
    plugins: ['react-native-worklets/plugin'],
  }
}
