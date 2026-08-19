# @bvc/reporting

## Controlerapport (rauw brondata-overzicht, geen grootboekmapping)

`renderControlerapportHtml` rendert een trial-balance-achtig overzicht
rechtstreeks uit de cache: grootboek-totalen per rekening (boekingen),
balans-eindsaldi, servicekosten per kostensoort, contracten/units/
rentroll-listing en complex-totalen. **Bewust geen grootboekmapping en
geen servicekosten-uitsluitingsregels toegepast** — dit rapport dient om
de ingelezen brondata regel-voor-regel te vergelijken met een bestaande
rapportage (reconciliatie), niet als KPI-analyse. Blokkeert nooit op een
ontbrekende/nog niet geladen bron (begroting, ouderdomsanalyse) — toont
dan een duidelijke melding in die sectie. `apps/worker`'s
`genereerControlerapport` bouwt de invoer uit de SQLite-cache (leest
niet uit Excel) en schrijft naar `rapporten/`; CLI: `bvc-worker
controlerapport <administratieId>`.

Dit was de **eerste** sectie die tegen een echte, herbouwde cache is
gevalideerd (zie root-README); de P&L-periodeberekening hieronder is de
tweede. Kerncijfers en het bredere P&L-/balansrapport zijn dat nog niet.

## P&L-periodeberekening (`plPeriodeBerekening.ts`) — rekenkern + vergelijking, nog geen renderer

De eerste koppeling van de goedgekeurde grootboekmapping (`@bvc/config`,
zie `packages/config/README.md`) en de expliciete periodeselectie
(`@bvc/cache`'s `periodeSelectie.ts`, zie `packages/cache/README.md`) aan
een daadwerkelijke berekening. Bewust **klein gehouden**: alleen de
rekenkern en een vergelijkingsfunctie, **geen HTML/renderer** — dat is een
latere, losse stap.

- **`berekenPlPeriode(boekingen: Boekingsregel[], mappingRegels)`** —
  neemt een al-periodeselecteerde lijst boekingen (`@bvc/cache`'s
  `selecteerBoekingen`, buiten deze functie aangeroepen) en de
  grootboekmapping, en levert per rapportagepost de rapportregelsom
  (CAL-FIN-003, `rapportbedrag` × CAL-FIN-002 tekenconventie) plus
  categorietotalen. Rekent bewust **geen gecombineerd nettoresultaat**
  over categorieën heen uit (Kosten en Opbrengsten kunnen, afhankelijk van
  hun tekenconventie, allebei als positief bedrag gepresenteerd worden —
  zoals bij de goedgekeurde `070_Rooise_Zoom`-mapping — dus een blinde som
  over alle categorieën zou geen betekenisvol resultaat opleveren; welke
  categorieën optellen/aftrekken voor een resultaatregel is een
  indelingsvraag die nog niet geformaliseerd is). Grootboekrekeningen met
  een niet-nul saldo die niet verwerkt konden worden (onbekende rekening,
  inactieve mapping, onbevestigde tekenconventie) komen in
  `controleVereist` — nooit stilzwijgend overgeslagen.
- **`vergelijkMetGereconcilieerd(resultaat, verwachtePerRapportagepost,
  toleranceEuro)`** — vergelijkt automatisch per rapportagepost met eerder
  handmatig gereconcilieerde bedragen (hergebruikt CAL-FIN-009/010,
  `budgetafwijking(Pct)`: "verwacht" = budget, "berekend" = realisatie).
  `verwachtePerRapportagepost` is een `Map<string, OnbekendOf<Decimal>>` —
  een verwacht bedrag kan zelf `OnbekendOf`-`onbekend` zijn (bv. "deze post
  wordt pas aan het einde van het boekjaar bepaald en geboekt"); zo'n regel
  belandt in `nogNietBekend`, nooit in `ontbrekendInBerekening` of als
  fout. Dit is een generieke, per rapportagepost in de invoerdata
  aangeleverde uitzondering (CLAUDE.md §3) — geen hardcoded uitzondering
  voor een specifiek grootboekrekeningnummer in code. Rapportageposten die
  verder maar aan één kant voorkomen belanden in
  `ontbrekendInBerekening`/`onverwachtInBerekening`, nooit als 0 vergeleken.
- **`apps/worker/src/genereerPlPeriode.ts`** — leest de cache
  (`selecteerBoekingen` op bedrijfsnr + boekjaar + boekperiode-range) en de
  goedgekeurde grootboekmapping, converteert cacherijen naar
  `Boekingsregel` (Decimal), en roept `berekenPlPeriode` aan. CLI:
  `bvc-worker pl-periode <administratieId> --boekjaar N [--periodeVan P
  --periodeTotEnMet P] [--verwacht <pad-naar-json>] [--tolerantie N]`.
  `--verwacht` wijst naar een ad-hoc JSON-bestand met de al gereconcilieerde
  bedragen, per rapportagepost een `OnbekendOf<Decimal>` in JSON-vorm:
  ```jsonc
  {
    "Beheerkosten": { "type": "bekend", "waarde": "6446" },
    "Niet verrekenbare BTW": { "type": "onbekend", "reden": "Wordt pas aan het einde van het boekjaar bepaald en geboekt" }
  }
  ```
  Geen vaste locatie in de data root, dit is invoer per vergelijking, geen
  permanente config. Print JSON naar stdout (geen bestand, geen HTML) en
  zet de exitcode op 1 als `controleVereist` niet leeg is.

## Balans-periodeberekening (`balansPeriodeBerekening.ts` + `renderBalansPeriode.ts`)

Tweede koppeling van dezelfde bewezen keten (goedgekeurde master+override-
grootboekmapping + expliciete periodeselectie) aan een balans, náást de
P&L hierboven — beide zijn outputs van dezelfde rekenlaag (CLAUDE.md §2),
geen parallelle berekening. Regressie-administratie: `070_Rooise_Zoom`
(de al bewezen P&L-uitkomst blijft ongewijzigd, zie `genereerPlPeriode.test.ts`).

- **Peildatum zonder cache-schemawijziging.** De cache bevat geen
  boekperiode-kolom in `balansstanden` (alleen een jaareindsaldo — zie
  `selecteerBalansOpBoekperiode`'s "bekend, nog niet opgelost gat"). Het
  saldo op een expliciete boekjaar+boekperiode-peildatum is desondanks
  reproduceerbaar zonder Worker-importarchitectuurwijziging: `saldo =
  beginbalans (jaarstart, uit `balansstanden`) + som van boekingen t/m de
  opgegeven boekperiode` (`@bvc/cache`'s `selecteerBoekingen`, zoals de
  P&L-periodeselectie). Ontbreekt de beginbalans (beide velden `null`),
  dan is het saldo expliciet niet te bepalen — nooit stilzwijgend 0
  aangenomen (CLAUDE.md §6).
- **`berekenBalansPeriode(balansstanden, boekingen, mappingRegels,
  toleranceEuro?)`** — per BALANS-soort rekening: beginbalans + mutaties
  in de periode. RESULTAAT-soort rekeningen (die horen in de P&L) worden
  hier bewust genegeerd in `posten`/`controleVereist`, maar hun rauwe
  mutatie telt mee in `aansluiting.resultaatTotaal`. Onbekende/inactieve
  rekeningen en BALANS-rekeningen zonder bepaalbare beginbalans belanden —
  net als bij `berekenPlPeriode` — in `controleVereist`, nooit
  stilzwijgend weggelaten.
- **Activa/Passiva: structureel, niet geraden.** Geen nieuwe
  grootboekmapping-classificatie deze bouwstap (expliciete scope-grens) en
  geen classificatie op basis van rekeningomschrijving. In plaats daarvan
  is de indeling zuiver het netto debet/creditkarakter van het berekende
  saldo: netto-debet = Activa, netto-credit = Passiva. Dat is precies de
  boekhoudkundige betekenis van "debet/credit blijven gescheiden"
  (CLAUDE.md §6) toegepast op balanszijde-bepaling — geen tekst-heuristiek.
  `rapportagepost`/omschrijving komt rechtstreeks uit de bron
  (`Rekening_omschrijving`), ook geen classificatie, alleen doorgegeven.
- **Aansluitingscontrole (`aansluiting`).** `activaTotaal + passivaTotaal
  (signed, bewust geen `.abs()`) + resultaatTotaal` hoort ~0 te zijn bij
  een complete, correct gemapte balans waarvan de beginbalans van alle
  BALANS-rekeningen zelf al op 0 sluit (activa = passiva + eigen vermogen
  bij jaarbegin — dubbel boekhouden). Een afwijking is dan exact herleidbaar
  tot de som van de `controleVereist`-mutaties (zie
  `genereerBalansPeriode.test.ts` voor een doorgerekend voorbeeld);
  ontbreekt die beginbalans-sluiting zelf (onvolledige/foutieve brondata),
  dan schuift dat mee door in `verschil` — bewust geen stilzwijgende
  correctie.
- **`apps/worker/src/genereerBalansPeriode.ts`** — leest de cache
  (`boekingen` via `selecteerBoekingen` met alleen `boekperiodeTotEnMet`,
  `balansstanden` op bedrijfsnr+jaar) en dezelfde goedgekeurde
  master+override-mapping als `genereerPlPeriode`. CLI: `bvc-worker
  balans-periode <administratieId> --boekjaar N --periodeTotEnMet P
  [--tolerantie N]`. Exitcode 1 bij niet-lege `controleVereist` of een
  niet-sluitende aansluitingscontrole.
- **`renderBalansPeriodeHtml`** — rendert uitsluitend de al-berekende
  `BalansPeriodeResultaat` (geen eigen berekening): Activa-/Passiva-
  tabellen met rekening/omschrijving/saldo + subtotaalrij, de
  aansluitingscontrole, en een altijd zichtbare "Controle vereist"-sectie
  (ook als leeg — dan een expliciete "geen"-melding, geen weggelaten
  sectie).
- **Gedeelde row-mappers.** `apps/worker/src/rowMappers.ts`
  (`naarBoekingsregel`, `naarBalansstand`) is uit `genereerPlPeriode.ts`
  getrokken zodat beide Worker-commando's dezelfde cacherij→domeintype-
  conversie gebruiken — geen duplicatie.

## Grootboek-inventarisatie (`grootboekInventarisatie.ts`) — voorbereiding op een centrale mastermapping

Puur diagnostisch, alleen-lezen: past geen mapping toe, verandert niets.
Voorbereidende stap voor schaalbaarheid van de grootboekmapping naar
meerdere administraties (tot nu toe was `070_Rooise_Zoom` de enige, volledig
handmatig doorlopen administratie).

- **`inventariseerGrootboekrekeningen(boekingen, balansomschrijvingen)`** —
  groepeert grootboekrekeninggebruik per Bedrijfsnr (aantal boekingen,
  rauw saldototaal) en koppelt de omschrijving + ruwe `Balans_vw`-waarde uit
  de `balans_per_jaar`-bron (meest recente boekjaar per Bedrijfsnr+rekening).
  Per rekeningnummer: `consistent: true` alleen als omschrijving én
  `balansVw` exact gelijk zijn bij elk Bedrijfsnr dat de rekening gebruikt —
  dat is de enige basis om een rekening automatisch als "betrouwbaar gelijk
  over administraties" te bestempelen; bij de kleinste afwijking `false`,
  nooit gegokt.
- **`apps/worker/src/genereerGrootboekInventarisatie.ts`** — leest
  `bron_gedeeld/boekingen.xlsx` en `bron_gedeeld/balans_per_jaar.xlsx`
  rechtstreeks en ongefilterd (alle Bedrijfsnr-waarden die in het bestand
  voorkomen), niet via een per-administratie cache. CLI: `bvc-worker
  grootboek-inventarisatie` (geen `administratieId`, geen `BVC_DATA_ROOT`-
  administratie nodig — werkt direct op de gedeelde bron). Beperking: dekt
  alleen bronnen die op `'gedeeld'` staan (de standaardinstelling); een
  administratie met `'eigen'` boekingen/balans_per_jaar zit hier nog niet
  in.
- **Nog onbevestigd:** of de brondata-kolom `Balans_vw` daadwerkelijk
  Bal/V&W aangeeft (zoals de "Srt"-kolom in het handmatig aangeleverde
  rekeningschema van `070_Rooise_Zoom`) — dat blijkt pas uit de echte
  waarden die `grootboek-inventarisatie` teruggeeft. Als dat bevestigd
  wordt, kan de `soort`-classificatie (zie `packages/config/README.md`)
  mogelijk rechtstreeks uit deze gedeelde bron afgeleid worden i.p.v. per
  administratie een apart rekeningschema te moeten aanleveren — nog niet
  aangenomen, alleen een mogelijkheid om te verifiëren.

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
| 04 | Balans | `renderBalans` | ~1725 | ✅ gebouwd (`balansPeriodeBerekening.ts` + `renderBalansPeriode.ts`) — zie sectie hieronder |
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
