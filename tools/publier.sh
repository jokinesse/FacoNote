#!/bin/bash
# Publication FacoNote : vérifie tout, puis compile, redémarre, contrôle et pousse sur GitHub.
# S'arrête à la première erreur. À lancer sur le serveur, depuis un compte avec sudo :
#   bash /var/www/faconote/tools/publier.sh            (publie + push)
#   bash /var/www/faconote/tools/publier.sh --sans-push
set -euo pipefail

APP=/var/www/faconote
SITE=https://faconote.jokinesse.be
DEPLOY_KEY=${FACONOTE_DEPLOY_KEY:-/etc/faconote/deploy_key}
PUSH=1
[ "${1:-}" = "--sans-push" ] && PUSH=0

run() { sudo -u faconote env PYTHONDONTWRITEBYTECODE=1 "$@"; }
git_app() { sudo -u faconote git -C "$APP" "$@"; }
step() { echo; echo "== $*"; }

cd "$APP"

step "0/9 État du dépôt"
[ "$(git_app branch --show-current)" = "main" ] || { echo "Il faut être sur la branche main."; exit 1; }
if [ -n "$(git_app status --porcelain --untracked-files=no)" ]; then
  echo "Des modifications ne sont pas enregistrées (commit) :"; git_app status --short --untracked-files=no; exit 1
fi
git_app log --oneline -1

step "1/9 Tests du moteur";  run .venv/bin/python -m pytest -q -p no:cacheprovider | tail -1
step "2/9 Typage Python";    run .venv/bin/python -m mypy --cache-dir=/dev/null backend/app | tail -1
step "3/9 Contrat frontend / backend"; run .venv/bin/python tools/check_contract.py

step "4/9 Garde-fou : aucun calcul métier dans le frontend"
FORBIDDEN='getMaterialDensity|getMaterialWeightDetails|findMatchingBound|resolveAutoPieceBreakdown|runOptimization|createInitialIntervals|densit[ye][A-Za-z]*\s*\*|\*\s*densit|utils/optimizer|utils/sheetLogic'
# Outils autorisés : calculette d'atelier (mathEvaluator), Stress Lab
if sudo grep -rnE "$FORBIDDEN" frontend/src --include=*.ts --include=*.tsx \
     | grep -vE 'frontend/src/(utils/mathEvaluator|utils/stressEngine|components/StressLab|components/WorkshopCalculator)'; then
  echo "Calcul métier détecté dans le frontend (lignes ci-dessus) : il doit passer par le backend."; exit 1
fi
if sudo grep -rn "evaluateExpression" frontend/src --include=*.ts --include=*.tsx \
     | grep -vE 'frontend/src/(utils/mathEvaluator|components/WorkshopCalculator)'; then
  echo "Évaluation de formule dans le frontend hors calculette d'atelier : elle doit passer par le backend."; exit 1
fi
echo "OK"

cd frontend
step "5/9 Typage TypeScript"; run node node_modules/typescript/bin/tsc --noEmit; echo "OK"

step "6/9 Compilation (sauvegarde de la version en ligne avant)"
BACKUP="dist.bak.$(date +%Y%m%d-%H%M%S)"
sudo cp -a dist "$BACKUP"; echo "Sauvegarde : frontend/$BACKUP"
run node node_modules/vite/bin/vite.js build --logLevel warn
sudo chmod 750 dist dist/assets; sudo chmod 640 dist/index.html dist/assets/*
cd "$APP"

step "7/9 Redémarrage du backend"
sudo systemctl restart faconote; sleep 4; systemctl is-active faconote

step "8/9 Contrôles du site"
c() { curl -s -o /dev/null -w '%{http_code}' --resolve faconote.jokinesse.be:443:127.0.0.1 "$@"; }
fail=0
for url in "/" "/api/health" "/api/v1/optimizer/reference"; do
  code=$(c "$SITE$url"); echo "   GET  $url : $code"; [ "$code" = 200 ] || fail=1
done
for url in "/api/v1/optimizer/pieces-summary" "/api/v1/optimizer/coil-summary"; do
  code=$(c -X POST -H 'Content-Type: application/json' -d '{"entries":[]}' "$SITE$url"); echo "   POST $url : $code"; [ "$code" = 200 ] || fail=1
done
if [ $fail = 1 ]; then
  echo "Contrôle en échec. Retour arrière du frontend : sudo rm -rf $APP/frontend/dist && sudo mv $APP/frontend/$BACKUP $APP/frontend/dist"
  echo "Retour arrière du backend : git checkout <commit précédent> puis sudo systemctl restart faconote"
  exit 1
fi

if [ $PUSH = 1 ]; then
  step "9/9 Push sur GitHub"
  sudo GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$(dirname "$DEPLOY_KEY")/known_hosts" \
    git -c safe.directory="$APP" -C "$APP" push git@github.com:jokinesse/FacoNote.git main:main
  git_app update-ref refs/remotes/origin/main main
  sudo chown -R faconote:faconote "$APP/.git"
else
  step "9/9 Push sur GitHub : ignoré (--sans-push)"
fi

echo; echo "Publication terminée."
