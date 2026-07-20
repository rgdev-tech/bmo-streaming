#!/usr/bin/env bash
# Control remoto por consola para probar la app de TV.
#
# El panel "Extended Controls" del emulador depende de que la ventana tenga el
# foco de macOS y a veces no manda nada. Esto entra por adb, así que funciona
# siempre y sirve igual para el emulador que para un Fire TV conectado.
#
# Uso:
#   ./scripts/remote.sh abajo derecha ok      # varias teclas seguidas
#   ./scripts/remote.sh                       # modo interactivo
#
# Con varios dispositivos conectados, elegí uno:
#   BMO_DEVICE=172.16.0.48:5555 ./scripts/remote.sh abajo

set -euo pipefail

ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
[ -x "$ADB" ] || { echo "No encuentro adb en $ADB"; exit 1; }

# Si no se indica dispositivo, se toma el único conectado.
if [ -n "${BMO_DEVICE:-}" ]; then
  TARGET=(-s "$BMO_DEVICE")
else
  count=$("$ADB" devices | grep -cw device || true)
  if [ "$count" -eq 0 ]; then
    echo "No hay dispositivos. Levantá el emulador o conectá el Fire TV:"
    echo "  adb connect 172.16.0.48:5555"
    exit 1
  elif [ "$count" -gt 1 ]; then
    echo "Hay más de un dispositivo. Elegí con BMO_DEVICE=<id>:"
    "$ADB" devices | grep -w device
    exit 1
  fi
  TARGET=()
fi

key() {
  case "$1" in
    arriba|up|w)        code=DPAD_UP ;;
    abajo|down|s)       code=DPAD_DOWN ;;
    izq|izquierda|left|a)  code=DPAD_LEFT ;;
    der|derecha|right|d)   code=DPAD_RIGHT ;;
    ok|enter|center)    code=DPAD_CENTER ;;
    atras|back|b)       code=BACK ;;
    home)               code=HOME ;;
    menu)               code=MENU ;;
    *) echo "Tecla desconocida: $1"; return 1 ;;
  esac
  # La expansión rara es para bash 3.2 (el que trae macOS): con `set -u`, un
  # array vacío da "unbound variable" si se expande a secas.
  "$ADB" ${TARGET[@]+"${TARGET[@]}"} shell input keyevent "KEYCODE_$code"
}

if [ $# -gt 0 ]; then
  for k in "$@"; do key "$k"; sleep 0.35; done
  exit 0
fi

cat <<'AYUDA'
Control remoto. Se lee tecla por tecla, sin Enter.

  ↑ ↓ ← →   cruceta          (también w a s d)
  Enter      OK              (también espacio)
  b          atrás
  q          salir

AYUDA

# -s: no ecoar la tecla. -n1: devolver apenas hay un carácter, sin esperar Enter.
# Las flechas no son un carácter: mandan ESC [ A. Por eso, al ver un ESC se leen
# los dos bytes siguientes con timeout — el timeout distingue una flecha de un
# ESC suelto (que sería la tecla Escape).
#
# El timeout va en segundos ENTEROS: el bash 3.2 de macOS rechaza fracciones
# ("invalid timeout specification"). No se nota: los bytes de una flecha llegan
# de inmediato, el segundo de espera solo aplica al apretar Escape a secas.
while IFS= read -rsn1 c; do
  case "$c" in
    $'\e')
      rest=''
      read -rsn2 -t 1 rest || true
      case "$rest" in
        '[A') key arriba ;;
        '[B') key abajo ;;
        '[D') key izq ;;
        '[C') key der ;;
        *)    key atras ;;   # Escape solo = atrás
      esac
      ;;
    '' | ' ')  key ok ;;     # Enter llega como cadena vacía
    w) key arriba ;;
    s) key abajo ;;
    a) key izq ;;
    d) key der ;;
    b) key atras ;;
    q) echo "chau"; exit 0 ;;
    *) ;;                    # cualquier otra cosa se ignora en silencio
  esac
done
