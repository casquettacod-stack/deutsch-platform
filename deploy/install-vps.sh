#!/usr/bin/env bash
# Installation sur un VPS Ubuntu/Debian neuf. À lancer en root dans le dossier du projet :
#   sudo bash deploy/install-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null; then
  echo "▶ Installation de Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null; then
  echo "▶ Pare-feu : SSH, HTTP, HTTPS"
  ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
fi

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
  PW=$(openssl rand -base64 12 | tr -d '/+=')
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$PW/" .env
  echo "▶ Fichier .env créé. Mot de passe admin : $PW  (notez-le !)"
  echo "  Modifiez .env (DOMAIN, ADMIN_EMAIL, CENTER_NAME) puis relancez ce script si besoin."
fi

mkdir -p data && chown -R 1000:1000 data
docker compose up -d --build
sleep 3
docker compose exec -T app node --disable-warning=ExperimentalWarning src/seed.js
echo "✔ Plateforme en ligne. Ouvrez http://$(curl -s ifconfig.me || hostname -I | awk '{print $1}')"
