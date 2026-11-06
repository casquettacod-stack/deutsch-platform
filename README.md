# 🇩🇪 Deutschzentrum – Plateforme e-learning

Plateforme complète pour un centre de langue allemande : site public, cours en ligne, examens (Lesen / Hören / Schreiben), test de niveau, correction, notes et administration.

## Fonctionnalités

| Rôle | Ce qu'il peut faire |
|---|---|
| **Visiteur** | Page d'accueil (niveaux A1→C2, examens Goethe/telc/ÖSD), formulaire de demande d'inscription, création de compte |
| **Étudiant** | Test de niveau (Einstufungstest) avec niveau recommandé automatiquement · cours (vidéo YouTube/Vimeo, PDF, audio, texte) avec progression · examens chronométrés avec sauvegarde automatique · résultats détaillés par partie · notes du professeur et moyenne /20 |
| **Professeur** | Créer cours et leçons · inscrire des étudiants ou des groupes entiers · créer des examens (QCM, Richtig/Falsch, réponse courte, rédaction) avec fichiers audio · correction automatique + correction manuelle des rédactions · résultats et export Excel (CSV) · carnet de notes par groupe (oral, devoirs…) |
| **Admin** | Tout ce que fait le professeur + gestion des comptes, import d'étudiants en masse, groupes/classes avec horaires, demandes d'inscription (bouton WhatsApp), annonces, sauvegarde de la base |

**Technique :** Node.js 22 + Express + EJS + SQLite (intégré à Node, aucune base externe à installer). Sessions sécurisées, protection CSRF, mots de passe chiffrés (bcrypt), en-têtes de sécurité (helmet), anti brute-force, fichiers accessibles uniquement aux utilisateurs connectés.

## Lancer en local

```bash
npm install
npm run seed:demo   # crée l'admin + données de démonstration
npm run dev         # http://localhost:3000
```

Comptes de démo : `admin@centre.ma / Admin12345!` · `prof@centre.ma / Prof12345!` · `etudiant@centre.ma / Etudiant123!`

Tests : `npm test`

## Déploiement sur VPS (Ubuntu 22.04/24.04)

1. Copier le projet sur le serveur (ex. `/opt/deutsch-platform`) :
   ```bash
   git clone <url-du-repo> /opt/deutsch-platform
   ```
2. Lancer l'installation (installe Docker, ouvre le pare-feu, génère `.env`, démarre tout) :
   ```bash
   cd /opt/deutsch-platform && sudo bash deploy/install-vps.sh
   ```
3. Ouvrir `http://IP-DU-VPS` et se connecter avec l'admin affiché.

### Activer le nom de domaine + HTTPS
1. Chez votre registrar, créer un enregistrement **A** : `plateforme.moncentre.ma → IP du VPS`.
2. Dans `.env` : `DOMAIN=plateforme.moncentre.ma` et `HTTPS=true`.
3. `docker compose up -d` → Caddy obtient le certificat Let's Encrypt automatiquement.

### Commandes utiles
```bash
docker compose logs -f app          # journaux
docker compose up -d --build        # mise à jour après git pull
bash deploy/backup.sh               # sauvegarde (à mettre en cron quotidien)
```

Les données (base `app.db` + fichiers déposés) sont dans `./data` — c'est ce dossier qu'il faut sauvegarder.
