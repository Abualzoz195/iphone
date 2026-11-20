# Prochains trains

Écran des prochains départs façon panneau de gare, en temps réel, avec les données de
l'API **PRIM** d'Île-de-France Mobilités. Première gare : **RER B – Châtelet - Les Halles**.

Deux façons de l'utiliser sur iPhone :

1. **Web app** (`index.html`) : publiée sur GitHub Pages, ajoutée à l'écran d'accueil, elle s'ouvre en plein écran comme une app.
2. **Widget Scriptable** (`scriptable/ProchainsTrains.js`) : les prochains trains directement sur l'écran d'accueil.

Aucun serveur : l'iPhone appelle directement l'API PRIM, qui accepte les appels depuis un navigateur.
La clé API n'est **jamais** dans le code : chaque appareil la garde pour lui (stockage du navigateur ou trousseau iOS).

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `css/style.css` | Style « écran de gare » |
| `js/config.js` | **Gares, lignes, sens et noms raccourcis — c'est ici qu'on ajoute des gares** |
| `js/prim.js` | Appels à l'API PRIM et lecture des réponses |
| `js/app.js` | Affichage, horloge, rafraîchissement, réglages |
| `manifest.webmanifest`, `icons/` | Nom et icône quand l'app est ajoutée à l'écran d'accueil |
| `scriptable/ProchainsTrains.js` | Widget iPhone (à copier dans l'app Scriptable) |

## Publier sur GitHub Pages

GitHub Pages est gratuit pour un dépôt **public**. Pour un dépôt privé, il faut un compte GitHub Pro.
Rendre ce dépôt public ne pose pas de problème de sécurité : la clé API n'y est pas.

1. Sur GitHub : **Settings → Pages**.
2. *Source* : **Deploy from a branch**, branche `main` (ou celle qui contient ces fichiers), dossier `/ (root)`, **Save**.
3. Une à deux minutes plus tard, l'adresse s'affiche en haut de la page : `https://<ton-pseudo>.github.io/iphone/`.

## Installer la web app sur l'iPhone

1. Ouvre l'adresse GitHub Pages dans **Safari**.
2. **Partager → Sur l'écran d'accueil → Ajouter**.
3. Ouvre l'app depuis l'icône, puis colle ta clé PRIM dans la fenêtre **Réglages**.

## Widget Scriptable

1. Installe **Scriptable** depuis l'App Store (gratuit).
2. Dans Scriptable, **+** pour créer un script, colle tout le contenu de `scriptable/ProchainsTrains.js`, renomme-le `Prochains trains`.
3. Lance-le une fois (▶︎) : il demande ta clé PRIM et la range dans le trousseau de l'iPhone.
4. Sur l'écran d'accueil : appui long → **+** → **Scriptable** → choisis la taille → **Ajouter**.
5. Appui long sur le widget → **Modifier le widget** → *Script* : `Prochains trains`.
   *Parameter* (facultatif) : `Retour` = vers Paris/CDG, `Aller` = vers Massy/Robinson.

iOS choisit lui-même quand rafraîchir les widgets (souvent toutes les 5 à 15 min). Les heures de départ
restent justes ; le « dans X min » se met à jour tout seul entre deux rafraîchissements. Toucher le widget relance le script.

## Ajouter une gare ou une ligne

1. Trouve l'identifiant de la gare (remplace `TA_CLE` et le nom) :
   ```
   curl -H "apikey: TA_CLE" "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/places?q=chatelet&type%5B%5D=stop_area"
   ```
   Dans la réponse, `"id": "stop_area:IDFM:474151"` donne `STIF:StopArea:SP:474151:`.
2. L'identifiant de la ligne est dans la même réponse (`"id": "line:IDFM:C01743"` → `STIF:Line::C01743:`).
3. Ajoute la gare dans `STATIONS` de `js/config.js` (et la ligne dans `LINES` si elle n'y est pas).
   Dès qu'il y a plusieurs gares, toucher le nom de la gare en haut de l'écran permet d'en changer.
4. Pour connaître les sens d'une nouvelle ligne : l'API renvoie `DirectionRef` = `Aller` ou `Retour`, à étiqueter dans `directions`.

## Tester sur ordinateur

```
python3 -m http.server 8000
```
puis ouvre http://localhost:8000 et entre ta clé dans **Réglages**.

## Quotas

L'API « Prochains passages » de PRIM a un quota journalier par clé. La web app interroge l'API toutes les
30 s seulement quand elle est à l'écran, et l'info trafic toutes les 5 min.
