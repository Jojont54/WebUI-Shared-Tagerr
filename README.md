# Tagarr

Tagarr est une WebUI privée pour consulter les bibliothèques Radarr/Sonarr et ajouter des tags aux films, séries et animes. Les collections Maintainerr apparaissent dans la navigation et sont triées par échéance de traitement, de la plus proche à la plus lointaine.

## Fonctionnalités du MVP

- double authentification : Plex par PIN ou OpenID Connect (OIDC) ;
- mode Plex par défaut, avec premier compte obligatoirement propriétaire d’un serveur Plex ;
- mode OIDC configurable par variables d’environnement, avec administration par groupe ;
- clés API chiffrées au repos et jamais envoyées au navigateur ;
- bibliothèques complètes Radarr et Sonarr ;
- séparation des animes d’après un profil de qualité Sonarr sélectionné ;
- collections Maintainerr chargées dynamiquement ;
- tableau avec recherche, filtre par tag, tri et sélection multiple ;
- affichage et tri de la date d’ajout dans Radarr ou Sonarr, y compris depuis une collection Maintainerr ;
- ajout ou retrait d’un tag existant sur un ou plusieurs contenus depuis une liste, sans risque de faute de frappe ;
- indication de la ou des saisons concernées dans les collections Maintainerr de séries et d’animes ;
- échéance Maintainerr (« demain », « dans 30 j », « en retard ») et tri croissant par défaut.

## Démarrage avec Docker

1. Copier `.env.example` vers `.env`.
2. Remplacer `APP_SECRET` par une valeur aléatoire d’au moins 32 caractères.
3. Adapter `APP_URL` à l’URL utilisée par le navigateur (HTTPS conseillé hors réseau local).
4. Démarrer l’application :

   ```bash
   docker compose up -d --build
   ```

5. Ouvrir `http://localhost:3131`, se connecter, puis renseigner Radarr, Sonarr et Maintainerr dans **Configuration**.

Les données sont conservées dans `./data/tagarr.sqlite`.

## Authentification

### Plex, mode par défaut

`AUTH_MODE=plex` conserve le flux Plex par PIN. Lors de la première connexion, Tagarr demande de sélectionner un serveur appartenant au compte Plex ; ce propriétaire devient administrateur. Si `AUTH_MODE` est absent, le mode Plex est utilisé. L’alias `AUTH_MOD` est également accepté.

### OpenID Connect / Authentik

Créez un fournisseur OAuth2/OIDC confidentiel dans Authentik avec le flux **Authorization Code** et déclarez cette URI de redirection exacte :

```text
https://tagarr.example.com/api/auth/oidc/callback
```

Configurez ensuite Tagarr dans `.env` :

```env
APP_URL=https://tagarr.example.com
AUTH_MODE=oidc
OIDC_ISSUER=https://auth.example.com/application/o/tagarr/
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_ADMIN_GROUP=tagarr-admin
OIDC_SCOPES=openid profile email
```

Le flux utilise `state`, `nonce` et PKCE S256. Le claim `sub` identifie l’utilisateur et le claim `groups` détermine l’appartenance à `OIDC_ADMIN_GROUP`. Tagarr ne contrôle volontairement pas `email_verified` et n’utilise l’adresse email que comme information d’affichage. Aucun refresh token n’est demandé par défaut.

Les membres de `OIDC_ADMIN_GROUP` accèdent à la configuration. Les autres utilisateurs authentifiés peuvent consulter les bibliothèques et modifier les tags. Un changement de `AUTH_MODE` invalide les sessions créées par l’autre mode.

## Développement

Node.js 22.5 ou plus récent est requis (Tagarr utilise le module SQLite intégré à Node).

```bash
pnpm install
pnpm dev
```

- WebUI Vite : `http://localhost:5173`
- API : `http://localhost:3131`

Commandes de vérification :

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Connexions réseau

Le conteneur Tagarr doit pouvoir joindre les URL de Radarr, Sonarr et Maintainerr. Avec Docker, n’utilisez pas `localhost` pour désigner un autre conteneur : utilisez son nom de service ou une adresse accessible depuis le conteneur.

Maintainerr doit idéalement rester sur le réseau privé. Selon sa version, son API interne n’offre pas forcément d’authentification stable ; Tagarr agit comme intermédiaire et ne l’expose pas directement au navigateur.

## Calcul de l’échéance Maintainerr

Tagarr calcule l’échéance à partir de la date d’ajout du média à la collection et du délai configuré dans Maintainerr. L’exécution réelle dépend ensuite de la planification du *Collection Handler* de Maintainerr : l’heure affichée est donc une échéance, pas la garantie d’une suppression à la minute près.

L’intégration utilise en priorité `GET /api/collections/overlay-data` (versions Maintainerr récentes), puis revient vers les routes de collections historiques. La documentation Swagger de l’instance Maintainerr reste la référence si son contrat diffère.
