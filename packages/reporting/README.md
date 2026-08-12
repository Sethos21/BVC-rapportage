# @bvc/reporting

## Kerncijfers (sectie 01 — KPI-dashboard)

`renderKerncijfersHtml` rendert het portefeuille-KPI-dashboard: 6
KPI-kaarten (huurinkomen, EBITDA, uitbetalingsratio, bankstand, debiteuren,
servicekosten-saldo, elk met mutatie-/statuskleur), kwartaalbalken
huurinkomen, huur-per-complextabel en een optionele bezettingsgraadkaart.
Poort van `legacy/index.html`'s `renderOverzicht` (zie
"Streefontwerp"-sectie hieronder), met herberekende cijfers via
`kerncijfers.ts` i.p.v. de inline JS-berekeningen uit legacy.
`renderKerncijfers.ts` rekent zelf niets uit.

Testcase: "Fergagne BV" (zie `*.test.ts`), dezelfde klant als het
aangeleverde streefontwerp-PDF.

## P&L-exploitatierapportage (eerste rapportonderdeel)

`renderPLRapportHtml` rendert een exploitatierapport per vastgoedobject in
BVC-huisstijl: coverpage, samenvatting, inkomsten, kosten, netto
exploitatieresultaat, een eenvoudige staafdiagram (inline SVG, geen
externe grafiekbibliotheek) en toelichting. Alle berekeningen staan in
`plRapport.ts` (hergebruikt `@bvc/domain`); `renderHtml.ts` rekent zelf
niets uit, alleen formatteren (`financieleberekeningen.md`: "geen
berekeningen in de UI-laag").

Testcase: object 070 "Rooise Zoom" (zie `*.test.ts`).

Nog niet gebouwd: PDF/DOCX-export (alleen HTML nu), en het bredere
rapportmodel uit het grote dossier (`def_rapportregel`/`def_kpi` uit
`04_Rapporten/`), dat voortbouwt op een **goedgekeurde** grootboekmapping
die er nog niet is (zie root-README). Dit P&L-rapport werkt met al
gevalideerde jaarcijfers als invoer, niet rechtstreeks met ruwe
Boekingen-rijen — die koppeling volgt in een latere fase.

## Streefontwerp volledige rapportage (bevestigd, nog te bouwen)

De gebruiker heeft een PDF-ontwerp (`BVC_Rapportage_Fergagne_2ekw2026.pdf`,
13 pagina's) aangeleverd als "hoe ik het uiteindelijk wil hebben". De
CSS-variabelen, sectie-ID's en `@media print`-paginabreaks in de PDF komen
exact overeen met `legacy/index.html` — dat bestand is dus de bevestigde
bron van het ontwerp, met een werkende (JS-gedreven) referentie-implementatie
per sectie. `legacy/index.html` is daarmee de te volgen spec voor structuur
en huisstijl; de rekenlogica daarin (inline JS) wordt **niet** hergebruikt —
die moet via `@bvc/domain`/`@bvc/reporting` herberekend worden, net als bij
de P&L-cijfers nu.

Huisstijl (kleuren, typografie, kaart-/tabelpatronen) staat gedeeld in
`huisstijl.ts` (`HUISSTIJL_CSS`, `escapeHtml`, `formatBedragHtml`,
`renderRapportDocument`) en wordt door elke sectierenderer hergebruikt.
Nog te porten secties (met bronregels in `legacy/index.html`):

| # | Sectie | Legacy render-functie | Regel | Status |
|---|---|---|---|---|
| 01 | Kerncijfers (KPI-dashboard: huurinkomen, EBITDA, uitbetalingsratio, bankstand, debiteuren, servicekosten-saldo + bezettingsgraad) | `renderOverzicht` | ~1502 | ✅ gebouwd (`kerncijfers.ts` + `renderKerncijfers.ts`) |
| 02 | Resultaat P&L per kwartaal | `renderPnl` | ~1580 | deels gebouwd (ander datamodel/CSS: jaarcijfers i.p.v. kwartaal+begroting) |
| 03 | Kasstroom | `renderCashflow` | ~1647 | nog te bouwen |
| 04 | Balans | `renderBalans` | ~1725 | nog te bouwen |
| 05 | Servicekosten (incl. stijgers/dalers, signaalbadges) | `renderServicekosten` | ~1859 | nog te bouwen |
| 06 | Verhuur / huuroverzicht (contracttabel, statusbadges op resterende looptijd) | `renderRentroll` | ~1897 | nog te bouwen |
| 07 | Onderhoud & investeringen | `renderOnderhoud` | ~1983 | nog te bouwen |
| 08 | Signalen & aandachtspunten | `renderSignalen` | ~2020 | nog te bouwen |

Elke sectie krijgt een eigen typed invoermodel (`types.ts`) en een puur
rekenmodule (zoals `plRapport.ts`/`kerncijfers.ts`) los van de renderer,
zodat de "geen berekeningen in de UI-laag"-regel overal geldt. Volgorde
nog te bepalen voor 03–08; 05 (Servicekosten, met stijgers/dalers en
signaalbadges) of 06 (Verhuur/huuroverzicht) liggen het meest voor de
hand als volgende stap, omdat ze qua databehoefte het dichtst bij de al
bestaande bron-/domeinfuncties liggen (`sources/servicekosten.ts`,
`sources/contracten.ts`, `resterendeLooptijdDagen`).
