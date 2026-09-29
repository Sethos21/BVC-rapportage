# Werkend UX-prototype — referentie

Deze map bevat de rechtstreeks leesbare bron van het vastgestelde UX-prototype voor de Begrotingsmodule.

## Status

Referentie, geen productiecode en geen zelfstandige bron van businesslogica. Bij afwijkingen zijn het actuele Master Contract, het FO, het addendum en `../09_Begrotingsmodule_UX_Vastgesteld.md` leidend volgens `../README.md`.

## Inhoud

- `index.html` — ingang van het prototype.
- `src/prototype.js` — interactie en voorbeeldgegevens.
- `src/prototype.css` — vormgeving.
- `public/assets/lucide.min.js` — lokale icoonasset.
- `server.mjs` — eenvoudige lokale statische server.
- `package.json` en `package-lock.json` — reproduceerbare start- en controletaken.
- `scripts/`, `worker/`, `tests/` en `.openai/hosting.json` — oorspronkelijke statische build- en hostingreferentie.

Bewust niet opgenomen: `node_modules`, gegenereerde `dist`-output, build-cache, QA-afbeeldingen, oudere captures, lokale ontwerpcontroledocumenten en ongebruikte React/Vite-steigers.

## Lokaal bekijken

Vanuit deze map:

```sh
npm run dev
```

De standaardpoort is `4173`. De bron heeft geen externe runtime-afhankelijkheden.

## Gebruik bij implementatie

Gebruik het prototype om schermopbouw, progressive disclosure, interacties, dichtheid en visuele hiërarchie te begrijpen. Neem voorbeeldbedragen, namen, codes en prototype-interne logica niet over als functionele waarheid.

