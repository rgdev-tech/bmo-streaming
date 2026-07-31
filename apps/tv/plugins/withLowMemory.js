const { withAndroidManifest, withMainApplication } = require('@expo/config-plugins')

// android:largeHeap le da al proceso un techo de heap Java más alto antes de
// OutOfMemoryError. En Fire TV / Mi Box de 1-2GB, con Hero/Backdrop a pantalla
// completa, es la diferencia entre un OOM silencioso (pantalla negra sin
// recuperación) y que la app aguante. apps/tv/android/ es gitignored (se
// regenera con `expo prebuild`), así que esto tiene que ir acá, no a mano.
function withLargeHeap(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0]
    if (app?.$) app.$['android:largeHeap'] = 'true'
    return config
  })
}

// Reenvía onTrimMemory (aviso de presión de memoria de Android) a JS como
// evento 'lowMemory' con el nivel. Sin esto, el sistema mata el proceso sin
// que la app tenga chance de soltar caches primero.
function withTrimMemoryBridge(config) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents
    if (src.includes('onTrimMemory')) return config

    src = src.replace(
      'import android.content.res.Configuration',
      'import android.content.res.Configuration\nimport com.facebook.react.modules.core.DeviceEventManagerModule'
    )

    src = src.replace(
      'override fun onConfigurationChanged(newConfig: Configuration) {',
      [
        'override fun onTrimMemory(level: Int) {',
        '    super.onTrimMemory(level)',
        '    reactHost.currentReactContext',
        '      ?.takeIf { it.hasActiveCatalystInstance() }',
        '      ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)',
        '      ?.emit("lowMemory", level)',
        '  }',
        '',
        '  override fun onConfigurationChanged(newConfig: Configuration) {',
      ].join('\n')
    )

    config.modResults.contents = src
    return config
  })
}

module.exports = function withLowMemory(config) {
  config = withLargeHeap(config)
  config = withTrimMemoryBridge(config)
  return config
}
