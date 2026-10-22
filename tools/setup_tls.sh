#!/usr/bin/env bash
# ==============================================================================
# Script d'activation TLS / HTTPS (Let's Encrypt + Nginx) pour chauve.click
# Usage : sudo bash tools/setup_tls.sh [votre-email@domaine.com]
# ==============================================================================

set -euo pipefail

DOMAIN="chauve.click"
WWW_DOMAIN="www.chauve.click"
EMAIL="${1:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "❌ Erreur : Ce script doit être exécuté en tant que root (sudo bash tools/setup_tls.sh)."
  exit 1
fi

echo "🚀 Configuration TLS / HTTPS pour ${DOMAIN}..."

# 1. Installation de Certbot et du plugin Nginx
echo "📦 Vérification / installation de Certbot et python3-certbot-nginx..."
apt-get update -y
apt-get install -y certbot python3-certbot-nginx dnsutils

# 2. Ouverture des ports HTTP (80) et HTTPS (443) si UFW est actif
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "🛡️ Ouverture des ports 80 et 443 dans UFW (Nginx Full)..."
  ufw allow 'Nginx Full' >/dev/null || true
fi

# 3. Vérification de la présence de server_name chauve.click dans Nginx
NGINX_CONF_FILE=$(grep -rnwl '/etc/nginx/sites-enabled/' -e "faconote" -e "8000" 2>/dev/null | head -n 1 || true)
if [[ -z "${NGINX_CONF_FILE}" ]]; then
  NGINX_CONF_FILE="/etc/nginx/sites-enabled/default"
fi

if [[ -f "${NGINX_CONF_FILE}" ]]; then
  if ! grep -q "${DOMAIN}" "${NGINX_CONF_FILE}"; then
    echo "🔧 Mise à jour de server_name avec ${DOMAIN} dans ${NGINX_CONF_FILE}..."
    cp "${NGINX_CONF_FILE}" "${NGINX_CONF_FILE}.bak.$(date +%s)"
    sed -i "s/server_name[[:space:]]\+_;/server_name ${DOMAIN} ${WWW_DOMAIN};/g" "${NGINX_CONF_FILE}"
  fi
fi

# Test et rechargement de Nginx avant Certbot
nginx -t
systemctl reload nginx

# 4. Détection automatique si le sous-domaine www pointe aussi sur le serveur
CERTBOT_DOMAINS=("-d" "${DOMAIN}")
SERVER_IP=$(curl -4 -s https://ifconfig.me || true)
WWW_IP=$(dig +short "${WWW_DOMAIN}" A | tail -n 1 || true)

if [[ -n "${SERVER_IP}" && "${WWW_IP}" == "${SERVER_IP}" ]]; then
  echo "✅ Le sous-domaine ${WWW_DOMAIN} pointe également vers ${SERVER_IP} : inclusion dans le certificat."
  CERTBOT_DOMAINS+=("-d" "${WWW_DOMAIN}")
else
  echo "ℹ️ Seul ${DOMAIN} sera inclus dans le certificat (${WWW_DOMAIN} ne pointe pas vers cette IP)."
fi

# 5. Gestion de l'email Let's Encrypt
if [[ -n "${EMAIL}" ]]; then
  EMAIL_ARGS=("--email" "${EMAIL}")
else
  EMAIL_ARGS=("--register-unsafely-without-email")
fi

# 6. Obtention et installation du certificat TLS avec redirection HTTP -> HTTPS
echo "🔐 Génération du certificat Let's Encrypt et configuration HTTPS..."
certbot --nginx \
  "${CERTBOT_DOMAINS[@]}" \
  "${EMAIL_ARGS[@]}" \
  --agree-tos \
  --redirect \
  --non-interactive

# 7. Activation du renouvellement automatique
echo "🔄 Activation du timer de renouvellement automatique..."
systemctl enable --now certbot.timer

# 8. Vérification finale
nginx -t
systemctl reload nginx

echo ""
echo "=============================================================================="
echo "✅ TLS / HTTPS est actif sur : https://${DOMAIN}"
echo "🔒 Redirection automatique HTTP -> HTTPS activée."
echo "🔄 Renouvellement automatique Let's Encrypt actif (certbot.timer)."
echo "=============================================================================="
