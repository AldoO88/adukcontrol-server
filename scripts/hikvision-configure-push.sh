#!/usr/bin/env bash
# scripts/hikvision-configure-push.sh
# ---------------------------------------------------------------------
# Configura el push HTTP Listening en una terminal Hikvision vía ISAPI.
# Equivalente a llenar el form de la web UI
#   System Configuration → HTTP(S) → HTTP Listening.
#
# Uso (desde la LAN de la escuela, con la terminal accesible):
#   HIKVISION_HOST=192.168.100.42 \
#   HIKVISION_ADMIN_USER=admin \
#   HIKVISION_ADMIN_PASS='tu-password' \
#   HIKVISION_EVENT_TOKEN="$(openssl rand -hex 32)" \
#   ./scripts/hikvision-configure-push.sh
#
# Output: imprime el token generado. Ese mismo token va en .env del backend
# como HIKVISION_EVENT_TOKEN y en el form "URL" de la terminal
# (/hikvision/event/<token>).
#
# Variables de entorno (todas requeridas):
#   HIKVISION_HOST         IP o dominio de la terminal (sin esquema).
#   HIKVISION_ADMIN_USER    Usuario admin (default "admin").
#   HIKVISION_ADMIN_PASS    Password del admin.
#   HIKVISION_EVENT_TOKEN   Token opaco que viajará en la URL (>= 32 chars hex).
#   HIKVISION_PUSH_URL      (Opcional) Path del push. Default "/hikvision/event".
#   HIKVISION_PROTOCOL      (Opcional) "HTTP" (default) o "HTTPS".

set -euo pipefail

: "${HIKVISION_HOST:?HIKVISION_HOST es requerido (IP o dominio de la terminal)}"
: "${HIKVISION_ADMIN_USER:=admin}"
: "${HIKVISION_ADMIN_PASS:?HIKVISION_ADMIN_PASS es requerido}"
: "${HIKVISION_EVENT_TOKEN:?HIKVISION_EVENT_TOKEN es requerido (ej. openssl rand -hex 32)}"
: "${HIKVISION_PUSH_URL:=/hikvision/event}"
: "${HIKVISION_PROTOCOL:=HTTP}"

# Cuerpo del PUT /ISAPI/Event/notification/httpHosts/1
read -r -d '' BODY <<JSON || true
{
  "HttpHostNotification": {
    "id": "1",
    "url": "${HIKVISION_PUSH_URL}/${HIKVISION_EVENT_TOKEN}",
    "protocolType": "${HIKVISION_PROTOCOL}",
    "parameterFormatType": "XML",
    "addressingFormatType": "ipaddress",
    "ipAddress": "${HIKVISION_HOST}",
    "portNo": 80,
    "httpAuthenticationMethod": "none"
  }
}
JSON

echo "[hikvision] Configurando push en http://${HIKVISION_HOST}/ISAPI/Event/notification/httpHosts/1"
echo "[hikvision] URL del push: ${HIKVISION_PUSH_URL}/${HIKVISION_EVENT_TOKEN}"
echo

curl --digest -u "${HIKVISION_ADMIN_USER}:${HIKVISION_ADMIN_PASS}" \
  -H "Content-Type: application/json" \
  -X PUT "http://${HIKVISION_HOST}/ISAPI/Event/notification/httpHosts/1" \
  --data "${BODY}" \
  -w "\n[HTTP %{http_code}]\n"

echo
echo "[hikvision] Token generado: ${HIKVISION_EVENT_TOKEN}"
echo "[hikvision] Pegalo en el .env del backend como HIKVISION_EVENT_TOKEN (el mismo valor)."
echo "[hikvision] Si preferís hacerlo desde la UI web: System Configuration → HTTP(S) → HTTP Listening."
