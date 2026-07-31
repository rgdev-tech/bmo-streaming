/**
 * La tipografía ahora vive en lib/theme.ts, junto al color y el espaciado:
 * separarla no tenía mucho sentido — al escribir una pantalla se eligen las
 * tres cosas a la vez. Este archivo queda sólo como puente para los imports
 * que ya existían.
 *
 * En código nuevo, importar desde '@/lib/theme'.
 */
export { screenTitle, rowHeading } from './theme'
