// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// @bmo/core vive en packages/core (fuera de este proyecto), enlazado por `file:`.
// Metro necesita vigilar esa carpeta para que el hot reload lo tome.
config.watchFolders = [path.resolve(repoRoot, 'packages/core')];

// CRÍTICO: apps/tv está FUERA del workspace de bun y usa react-native-tvos,
// mientras que packages/core/node_modules tiene el react-native común (0.81.5)
// que le instala bun para apps/client. Sin esto, Metro resolvería subiendo desde
// packages/core/src/*.ts y cargaría ESE react-native — dos RN en un bundle, que
// es justo lo que rompe el registro de TurboModules (crash 'PlatformConstants').
// disableHierarchicalLookup corta ese ascenso: todo se resuelve desde apps/tv.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

// When enabled, the optional code below will allow Metro to resolve
// and bundle source files with TV-specific extensions
// (e.g., *.ios.tv.tsx, *.android.tv.tsx, *.tv.tsx)
//
// Metro will still resolve source files with standard extensions
// as usual if TV-specific files are not found for a module.
//
/*
if (process.env?.EXPO_TV === '1') {
  const originalSourceExts = config.resolver.sourceExts;
  const tvSourceExts = [
    ...originalSourceExts.map((e) => `tv.${e}`),
    ...originalSourceExts,
  ];
  config.resolver.sourceExts = tvSourceExts;
}
 */

module.exports = config;
