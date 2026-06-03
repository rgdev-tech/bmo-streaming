import { tmdb } from '@/lib/tmdb'
import { CatalogScreen } from '@/components/CatalogScreen'

export default function PeliculasScreen() {
  return <CatalogScreen brand="Películas" kind="movie" load={() => tmdb.movies()} />
}
