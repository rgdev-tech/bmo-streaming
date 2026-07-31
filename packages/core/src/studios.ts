// Marcas/estudios que el buscador reconoce. Si el usuario escribe exactamente
// uno de estos alias, mostramos un catálogo especial de esa marca en vez de
// (o además de) los resultados normales. Las `key` deben coincidir con el
// registro STUDIOS del servidor (apps/api/src/tmdb/tmdb.routes.ts).
export type StudioBrand = {
  key: string
  name: string
  aliases: string[]
  // Colores del banner (degradado) — dan a cada marca su identidad propia.
  colors: [string, string]
}

export const STUDIO_BRANDS: StudioBrand[] = [
  { key: 'disney', name: 'Disney+', aliases: ['disney', 'disney+', 'disney plus', 'walt disney'], colors: ['#113CCF', '#0A1F6B'] },
  { key: 'hbo', name: 'HBO Max', aliases: ['hbo', 'hbo max', 'hbomax', 'max'], colors: ['#7B2FF7', '#3A1078'] },
  { key: 'netflix', name: 'Netflix', aliases: ['netflix'], colors: ['#E50914', '#7A0009'] },
  { key: 'prime', name: 'Prime Video', aliases: ['prime', 'prime video', 'amazon prime', 'amazon'], colors: ['#1FA2FF', '#0B5C9E'] },
  { key: 'appletv', name: 'Apple TV+', aliases: ['apple', 'apple tv', 'apple tv+', 'appletv'], colors: ['#4A4A4A', '#111111'] },
  { key: 'peacock', name: 'Peacock', aliases: ['peacock', 'peacock tv'], colors: ['#5A2FD6', '#1B0B4D'] },
  { key: 'marvel', name: 'Marvel', aliases: ['marvel', 'mcu'], colors: ['#ED1D24', '#7A0F13'] },
  { key: 'dc', name: 'DC', aliases: ['dc', 'dc comics', 'dceu'], colors: ['#1D6FB8', '#0A1B3D'] },
  { key: 'pixar', name: 'Pixar', aliases: ['pixar'], colors: ['#2AA5E0', '#F2C230'] },
  { key: 'starwars', name: 'Star Wars', aliases: ['star wars', 'starwars', 'lucasfilm'], colors: ['#000000', '#3A3A00'] },
  { key: 'paramount', name: 'Paramount', aliases: ['paramount', 'paramount+', 'paramount plus'], colors: ['#0064FF', '#00317A'] },
  { key: 'warner', name: 'Warner Bros.', aliases: ['warner', 'warner bros', 'warner brothers', 'wb'], colors: ['#123A87', '#0A1F4D'] },
  { key: 'universal', name: 'Universal', aliases: ['universal', 'universal pictures'], colors: ['#1B4B9E', '#0A244F'] },
  { key: 'dreamworks', name: 'DreamWorks', aliases: ['dreamworks', 'dream works'], colors: ['#1E6FCC', '#0B2E5C'] },
]

// Coincidencia exacta contra el query completo (no substring) — así "disney"
// abre el catálogo pero "disney movie" o un título que contenga la palabra no
// dispara falsos positivos. Se normaliza espacios y mayúsculas.
export function matchStudio(query: string): StudioBrand | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (q.length < 2) return null
  return STUDIO_BRANDS.find((b) => b.aliases.includes(q)) ?? null
}
