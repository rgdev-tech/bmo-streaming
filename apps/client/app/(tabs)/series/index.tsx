import { tmdb } from '@/lib/tmdb'
import { CatalogScreen } from '@/components/CatalogScreen'

export default function SeriesScreen() {
  return <CatalogScreen brand="Series" kind="tv" load={() => tmdb.series()} />
}
