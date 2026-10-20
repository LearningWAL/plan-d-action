# Plan d'action — évaluation de maturité cyber

Outil **100 % local** (un dossier statique, aucun serveur, aucune installation) qui transforme un questionnaire d'évaluation de maturité Excel en **plan d'action** priorisé, exportable en Excel.

> Double-cliquez sur `index.html` : l'outil s'ouvre dans Chrome, Edge ou Firefox, même hors ligne.

## Ce que fait l'outil

| Entrée | Rôle |
|---|---|
| **Colonne « Exigence »** (au choix) | une ligne d'exigence = une action potentielle |
| **Colonnes de commentaires des interviewés** (une ou plusieurs) | décrivent la **situation actuelle** et permettent d'**estimer la maturité** |
| Colonne de score / réponse (optionnelle) | « 3 », « 2/5 », « 60 % », « Oui / Non / Partiel », « N/A »… prioritaire sur les commentaires |
| Colonne **recommandation** (optionnelle) | mesure directement reprise dans le plan |
| **Référentiels** (optionnels) : catalogue Excel/CSV ou **PDF** | mesures rapprochées des exigences par similarité de texte locale (TF-IDF) |
| Colonnes domaine, référence, criticité (optionnelles) | regroupement et priorisation |

Le plan généré contient pour chaque exigence en écart : situation actuelle, maturité actuelle → cible, écart, mesure(s) à mettre en place et leur source (traçabilité vers la ligne du questionnaire ou la page du PDF), priorité P1-P3, effort, quick win, horizon, responsable, échéance, statut. Tout est modifiable dans le tableau avant export.

### Logique déterministe (par défaut, sans IA)

- **Maturité** : score explicite si présent ; sinon lexique FR/EN pondéré sur les commentaires (« aucun », « non formalisé », « partiellement », « documenté », « revue annuelle », « automatisé »…) avec gestion simple des négations et un niveau de confiance. Un écart entre score et commentaires est signalé « à confirmer ».
- **Situation actuelle** : synthèse extractive des commentaires (phrases dédoublonnées).
- **Priorité** : écart × criticité → P1 / P2 / P3. **Effort** : heuristique sur la mesure (politique, procédure → faible ; outil, SIEM, PAM, segmentation → élevé). **Quick win** : écart ≥ 2 et effort faible.
- Les exigences « N/A » et celles déjà au niveau cible sont exclues (option pour les inclure en « maintenir »).

## Utilisation

1. **Questionnaire** : importez le fichier, vérifiez la feuille, la ligne d'en-tête (détectée automatiquement) et la correspondance des colonnes. La correspondance est mémorisée pour les fichiers de même structure.
2. **Référentiels** (optionnel) : ajoutez un catalogue de mesures (Excel/CSV, choix des colonnes ID / titre / description / domaine) ou des PDF (texte extrait localement par pdf.js ; les PDF scannés sans texte ne sont pas pris en charge).
3. **Paramètres** : échelle (0-5 par défaut), cible, source des mesures, seuil de pertinence → **Générer le plan d'action**.
4. **Plan d'action** : filtrez, corrigez, complétez → **Exporter en Excel** (onglets *Plan d'action*, *Synthèse*, *Paramètres*).
5. **Enregistrer / Ouvrir un projet** : sauvegarde JSON pour reprendre le travail (sans aucune clé API).

Exemples fictifs : `sample/questionnaire-exemple.xlsx` et `sample/referentiel-mesures-exemple.xlsx`.

## IA (optionnelle)

L'IA peut, ligne par ligne, reformuler la situation actuelle, ré-estimer la maturité et proposer des mesures **à partir des seuls extraits de référentiel retrouvés localement**. Le résultat est marqué « IA (à relire) ».

- **Autorisation obligatoire** : case « Je confirme que l'usage de l'IA est autorisé pour ce contenu et conforme aux règles du client. » Aucun appel (même la liste des modèles) n'est possible sans elle ; elle doit être recochée à chaque session.
- **Approbation de chaque envoi** : une fenêtre affiche le fournisseur, le modèle, la destination, le nombre de requêtes, le volume et l'aperçu exact du contenu envoyé.
- **Pseudonymisation** (activée par défaut) : e-mails, adresses IP, téléphones, hôtes internes et termes que vous listez (nom du client…) sont masqués avant envoi.
- **Fournisseurs** : OpenAI, Anthropic, Mistral, Azure OpenAI / Azure AI Foundry, Ollama Cloud (ou Ollama local sur `localhost`), endpoint générique compatible OpenAI. Champs affichés selon le fournisseur ; modèles chargés dynamiquement quand l'API le permet, sinon liste de repli indiquée clairement ; bouton « Tester la connexion » et état visible (non autorisée / incomplète / prête à tester / connectée / erreur).
- Toute la couche passe par un client unique `LLMClient` (`js/llm/llmClient.js`) : `getAvailableModels()`, `testConnection()`, `generate()` / `generateJSON()`, avec validation systématique (autorisation, fournisseur, modèle, clé, HTTPS, URL normalisée) avant chaque appel.

### Clés API

- Stockées **séparément** des données projet, dans `sessionStorage` (effacées à la fermeture de l'onglet) ; dans `localStorage` **uniquement** si « Mémoriser cette clé sur ce navigateur » est coché.
- Champs mot de passe, jamais réaffichées (seuls les 4 derniers caractères), bouton **Effacer les clés API**.
- Jamais incluses dans le projet JSON, l'export Excel, les prompts, les messages d'erreur ou la console : les exports sont filtrés et **bloqués** si une valeur ressemblant à une clé est détectée. Les anciennes clés stockées hors de l'espace dédié sont supprimées au démarrage.

### Erreurs et CORS

Les erreurs indiquent l'opération, le fournisseur, le modèle, le statut HTTP, le code et le message du fournisseur (sans secret). Si un fournisseur bloque les appels depuis le navigateur (CORS), voir [`docs/CORS.md`](docs/CORS.md) : endpoint compatible ou **proxy local strict optionnel** (`proxy/strict-proxy.mjs`).

## Structure

```
index.html            interface
css/app.css
js/                   logique (scripts classiques, compatibles file://)
  importer.js maturity.js matcher.js referential.js planBuilder.js exporter.js aiAssist.js app.js
  llm/                llmClient.js providers.js validation.js secrets.js consent.js errors.js
vendor/               xlsx-js-style 1.2.0 (Apache-2.0), pdf.js 3.11.174 (Apache-2.0), embarqués
proxy/                proxy CORS optionnel (Node, sans dépendance)
sample/               données fictives + script de génération
tests/                tests unitaires (node --test) et test de bout en bout Playwright
```

## Développement

```bash
npm test                 # tests unitaires, aucune dépendance (Node 18+)
npm run test:e2e         # test Chromium sur file:// (nécessite le paquet playwright)
node sample/generate-sample.js
```

Aucune étape de build : les fichiers sont servis tels quels.
