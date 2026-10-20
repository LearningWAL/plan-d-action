# Appels IA depuis le navigateur : CORS et endpoints compatibles

L'outil appelle les API d'IA directement depuis le navigateur (origine `file://`, vue comme `null`). Le fournisseur doit autoriser ces appels (CORS). Si ce n'est pas le cas, l'outil affiche « Requête bloquée (réseau, pare-feu ou CORS) » (code `NETWORK_OR_CORS`).

| Fournisseur | Appel direct depuis le navigateur | Remarque |
|---|---|---|
| OpenAI | en général oui | |
| Anthropic | oui | l'outil envoie l'en-tête `anthropic-dangerous-direct-browser-access: true` requis |
| Mistral | en général oui | |
| Azure OpenAI / AI Foundry | dépend de la ressource | configurez CORS côté Azure (ou API Management) si nécessaire |
| Ollama Cloud (`ollama.com`) | variable | utiliser le proxy si bloqué |
| Ollama local | oui si `OLLAMA_ORIGINS` autorise l'origine | ex. `OLLAMA_ORIGINS="null,file://*"` puis URL `http://localhost:11434` |
| Endpoint compatible OpenAI | dépend du serveur | LiteLLM, vLLM, passerelle d'entreprise… configurez l'origine `null` |

Un pare-feu ou proxy d'entreprise peut aussi bloquer ces domaines : l'erreur est alors identique.

## Solution 1 — endpoint compatible

Utilisez le fournisseur « Endpoint compatible OpenAI (générique) » avec une passerelle d'entreprise qui autorise CORS (HTTPS obligatoire ; `http` accepté uniquement pour `localhost` / `127.0.0.1`).

## Solution 2 — proxy local strict (optionnel)

`proxy/strict-proxy.mjs` est un petit proxy Node.js **sans dépendance**, qui n'est jamais requis pour utiliser l'outil :

```bash
node proxy/strict-proxy.mjs          # écoute sur http://127.0.0.1:8787
```

Puis, dans *Paramètres IA → Options avancées*, renseignez **Proxy local optionnel** : `http://127.0.0.1:8787`. Les paramètres du fournisseur restent inchangés et sont validés normalement.

Garanties du proxy :

- écoute uniquement sur `127.0.0.1` ; accepte seulement les origines `null` (file://) et `localhost` ;
- relaie **uniquement en HTTPS** vers une **liste blanche** d'hôtes (OpenAI, Anthropic, Mistral, Ollama, domaines Azure) ; ajout possible via `PDA_PROXY_EXTRA_HOSTS="llm.exemple.com,.mondomaine.ai"` ;
- en-têtes filtrés (`authorization`, `x-api-key`, `api-key`, `anthropic-version`, `content-type`, `accept`) ; redirections refusées ; corps limité à 2 Mo ; délai de 120 s ;
- journalise seulement date, méthode, hôte et statut, **jamais** les en-têtes, clés ou contenus ;
- erreurs renvoyées en JSON propre (`{"error":{"code","message"}}`).
