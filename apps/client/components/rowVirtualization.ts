/**
 * Ajustes de virtualización para las filas horizontales del catálogo.
 *
 * El Home apila unas diez filas dentro de un ScrollView vertical, y todas viven
 * montadas a la vez. Con los valores por defecto de FlatList
 * (initialNumToRender 10, windowSize 21) eso son ~100 tarjetas con su imagen
 * creadas de entrada y retenidas para siempre, más diez scroll views anidados.
 * Es lo que hace que el scroll VERTICAL se sienta pegado: el costo no está en
 * la fila que estás mirando sino en todo lo que quedó montado arriba y abajo.
 *
 * En un teléfono entran ~3 pósters de ancho, así que 4 iniciales ya llenan la
 * pantalla con un ítem de colchón; el resto se crea al deslizar la fila.
 *
 * `removeClippedSubviews` se deja en false a propósito: en iOS, con imágenes
 * dentro de una lista horizontal, deja celdas en blanco al volver. La
 * virtualización de FlatList ya hace el trabajo sin él.
 */
export const rowVirtualization = {
  initialNumToRender: 4,
  maxToRenderPerBatch: 4,
  windowSize: 3,
  removeClippedSubviews: false,
} as const

/**
 * getItemLayout para filas de ancho FIJO. Le ahorra a FlatList medir cada
 * tarjeta al vuelo, que es parte del costo de montar diez filas juntas.
 * Sólo sirve si todas las tarjetas de la fila miden lo mismo.
 */
export function fixedItemLayout(itemWidth: number) {
  return (_: unknown, index: number) => ({
    length: itemWidth,
    offset: itemWidth * index,
    index,
  })
}
