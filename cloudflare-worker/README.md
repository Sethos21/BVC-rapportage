# BVC Anthropic Proxy (Cloudflare Worker)

Houdt de Anthropic API-key server-side. De React-app roept deze Worker aan in plaats van rechtstreeks `api.anthropic.com` — de key komt daardoor nooit in de browser-bundle terecht.

## Eenmalig instellen

```bash
cd cloudflare-worker
npm install -g wrangler   # als je wrangler nog niet hebt
wrangler login

# Zet de echte Anthropic API-key als secret (wordt NIET in git opgeslagen)
wrangler secret put ANTHROPIC_API_KEY

wrangler deploy
```

Na `wrangler deploy` krijg je een URL zoals:

```
https://bvc-anthropic-proxy.<jouw-subdomain>.workers.dev
```

## De React-app koppelen aan de Worker

1. Zet die URL als repository **variable** (geen secret nodig, de URL is niet gevoelig):
   Settings → Secrets and variables → Actions → tab "Variables" → `REACT_APP_WORKER_URL`
2. Voor lokaal ontwikkelen: zet dezelfde waarde in een `.env.local` bestand in de projectroot (niet committen):
   ```
   REACT_APP_WORKER_URL=https://bvc-anthropic-proxy.<jouw-subdomain>.workers.dev
   ```

## Belangrijk: roteer de oude key

De vorige opzet stuurde de Anthropic API-key rechtstreeks naar de browser en heeft deze dus al publiek blootgesteld in eerdere GitHub Pages builds. Maak een **nieuwe** Anthropic API-key aan, gebruik die als `ANTHROPIC_API_KEY` secret hierboven, en verwijder/roteer de oude key in de Anthropic Console — die moet als gecompromitteerd worden behandeld.

## Opruimen in de hoofdrepo

De GitHub Actions secret `REACT_APP_ANTHROPIC_KEY` (gebruikt voor de React-build) is niet meer nodig en kan verwijderd worden.
