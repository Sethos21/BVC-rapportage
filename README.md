# BVC Rapportage (FinancieelRapport)

> Zie `CLAUDE.md` voor de leidende architectuurprincipes (verplichte
> leesstof vóór wijzigingen): deze repository is de projectbasis, maar
> `legacy/index.html` is nooit de technische basis — alleen visuele/
> functionele referentie. Strikte scheiding data/rekenlaag/presentatie,
> config-gestuurd (geen hardcoded uitzonderingen), dynamisch (rapport +
> interactief dashboard op dezelfde rekenlaag), Excel nu maar swappable
> naar DSN/SQL later.

Financiële vastgoedrapportagetool voor BVC. Inhoudelijk leidend is het
overdrachtsdossier **Vastgoed-AI_Architectuur_v2.0** (Google Drive,
eigenaar BVC), aangevuld en op punten overruled door twee latere lokale
overdrachtsdocumenten:

1. `CLAUDE_OVERDRACHT_LOKALE_DATAOPZET_v0.1.md`
2. `CLAUDE_AANVULLENDE_INSTRUCTIES_LOKALE_BRONNEN_v0.1.md` (laatste woord
   bij conflicten over repository, lokale opslag en bronselectie)

Dit document is een samenvatting, geen vervanging — bij twijfel gelden de
brondocumenten.

## Architectuur: lokaal, geen cloud, geen centrale database

**Belangrijke koerswijziging (2026-08-12):** het project startte als een
cloud-architectuur (Next.js + PostgreSQL, zie git-historie). Seth heeft dat
expliciet teruggedraaid: de applicatie moet **lokaal/on-premise** draaien,
bereikbaar binnen het interne bedrijfsnetwerk, zonder publieke SQL-hosting
of centrale databaseserver — de gegevens blijven in de werkomgeving.

- **Geen PostgreSQL, geen Prisma.** In plaats daarvan: de xlsx-bronbestanden
  zelf zijn leidend; een lokaal, volledig herbouwbaar SQLite-bestand
  (`node:sqlite`, ingebouwd in Node 22) dient uitsluitend als cache/index
  per administratie (`packages/cache`).
- **Eén administratie tegelijk**, niet-gelijktijdig gebruik door Seth en
  een paar collega's.
- **Hybride bronopslag**: per brontype én per administratie wordt expliciet
  gekozen tussen `gedeeld` (één centrale map met regels voor meerdere
  administraties, gefilterd op `Bedrijfsnr`) of `eigen` (bronmap van die
  ene administratie). Nooit automatisch samenvoegen of uitwijken.
- **Geen bronarchief.** Per bronmap/brontype staat alleen het actuele
  bestand; een geldige nieuwe import vervangt het vorige atomisch. Geen
  historische kopieën — wel auditmetadata (jsonl).

## Structuur

```
apps/
  web/              Next.js-app (rapportages — nog grotendeels te bouwen; draait lokaal, geen cloud-hosting)
  worker/           Bronresolver, veilig vervangingsprotocol, cache-herbouw (CLI)
packages/
  domain/           Centrale berekeningen + geld-/percentageformattering (CAL-FIN-*, CAL-VG-*, CAL-CTR-*, huisstijlregels)
  config/           Versioned beheerparameters (Zod-schema + standaardwaarden) — uitzonderingen/normen config-gestuurd, nooit hardcoded (CLAUDE.md §3)
  data-contracts/   Zod-schema's + parsers per brontype, op de ECHTE kolomnamen van de IDBC-exports
  cache/            Lokale herbouwbare SQLite-cache (geen systeem-van-record)
  reporting/        Rapportsecties (rekenmodule + HTML-renderer per sectie, huisstijl gedeeld) — zie packages/reporting/README.md
  tests/            Pre-flight-/integratietests voor apps/worker tegen de echte publieke API (init-administratie/status/rebuild-cache)
legacy/             Oorspronkelijke single-file HTML-prototype — uitsluitend visuele/functionele
                    referentie (zie CLAUDE.md), nooit technische basis: geen code hiervandaan
                    hergebruikt, alleen CSS-tokens/sectie-indeling bewust overgenomen en elders herbouwd
```

### Databronmap (runtime, niet in git)

```
<BVC_DATA_ROOT>/
├── config/                          parameters.json (@bvc/config-schema; ontbreekt = standaardwaarden),
│                                    rapportdefinities/, grootboekmappings/
├── bron_gedeeld/                    boekingen.xlsx, balans_per_jaar.xlsx, rentroll.xlsx, ...
├── audit/import_log_gedeeld.jsonl
└── administraties/<Bedrijfsnr>_<naam>/
    ├── administratie.json           bronlocaties per brontype: 'gedeeld' | 'eigen'
    ├── bron/                        alleen brontypen op 'eigen' (standaard: begroting)
    ├── cache/cache.sqlite           volledig herbouwbaar, geen historie
    ├── rapporten/
    └── audit/import_log.jsonl
```

`BVC_DATA_ROOT` is bewust configureerbaar (env var), geen hardcoded pad —
dit draait op verschillende werkcomputers.

## Wat nu al werkt

- **`packages/data-contracts`** — Zod-broncontracten voor 8 IDBC-bronnen
  (Boekingen, Balans, Servicekosten, Contracten, Units, RentRoll, Complex
  Totalen, **Ouderdomsanalyse**), op **echte, geverifieerde kolomnamen**.
  Bevestigde naamsinconsistenties tussen bronnen zijn expliciet in code
  gedocumenteerd (RentRoll: `Bedrijfsnummer`; Complex Totalen: `Complexnr`).
  Plus **`BVC_Begrotingsformat_v0.2.xlsx`** (metadata, Exploitatie,
  Servicekosten): begrotingswaarde wordt zelf herberekend uit q1–q4/
  jaarbedrag (nooit de brongrijze/berekende kolommen vertrouwd), met
  controles op tekenconventie, dubbele mapping-codes en `NIET_TOEGEWEZEN`-
  complexen.
- **`packages/domain`** — centrale financiële/vastgoedberekeningen plus
  geld-/percentageformattering conform de huisstijl- en rekenregels
  (`€ 1.250,75`, centen afronden per stap, nul is geldig, totalen altijd
  controleren).
- **`packages/cache`** — bouwt en opent de lokale SQLite-cache.
- **`packages/config`** — versioned beheerparameters (Zod-schema +
  `STANDAARD_PARAMETERS`): welke servicekosten-kostensoorten altijd worden
  uitgesloten, welke omschrijvingsvarianten een mogelijke serviceafrekening
  signaleren. Voorheen hardcoded in `data-contracts/sources/servicekosten.ts`,
  nu een parameter die de aanroeper meegeeft — zie CLAUDE.md §3. Bevat ook
  de **grootboekmapping** (Zod-schema, één JSON-bestand per administratie in
  de data root, `@bvc/domain`'s `zoekMappingRegel`/`presentatiefactorVoorRegel`
  voor de opzoek-/tekenconventielogica) — zie `packages/config/README.md`
  voor de volledige toelichting en de **goedgekeurde** mapping voor
  `070_Rooise_Zoom` (14 rekeningen, incl. tekenconventie per rekening).
- **`@bvc/cache`'s `periodeSelectie.ts`** — expliciete periodeselectie op
  boekingen (boekjaar + boekperiode-range) en balansstanden (boekjaar),
  nooit een impliciete eerste/laatste/willekeurige rij. Documenteert
  expliciet het bekende gat dat de cache geen balans per specifieke
  boekperiode binnen een jaar kan leveren (alleen jaareindsaldo) — zie
  `packages/cache/README.md`.
- **`packages/reporting`** — rapportsecties, elk met een eigen rekenmodule
  (los van de renderer) en gedeelde huisstijl (`huisstijl.ts`). Gebouwd:
  P&L-exploitatierapportage en sectie 01 Kerncijfers (KPI-dashboard). Zie
  `packages/reporting/README.md` voor de volledige sectie-roadmap.
- **`apps/worker`** — bronresolver (`gedeeld`/`eigen`, nooit samenvoegen),
  het veilige vervangingsprotocol (kopie → hash+validatie → bij fout niets
  wijzigen → atomisch vervangen → caches ongeldig maken → audit → opruimen),
  een crash-herstelbare lockfile, cache-herbouw met verplichte
  administratiescheiding (getest: een gedeeld bronbestand met meerdere
  administraties lekt nooit rijen tussen administraties), `init-administratie`
  (nieuwe administratie initialiseren zonder handmatig JSON te schrijven) en
  `laadBeheerparameters` (leest `config/parameters.json` uit de data root,
  valt terug op standaardwaarden als het bestand ontbreekt).
- **Cache-herbouw bij grote gedeelde bronbestanden.** `rebuild-cache` meldt
  nu per brontype voortgang (bestandsgrootte, ingelezen/gefilterde
  rijaantallen, verwerkingsduur — standaard naar stderr) en verwerkt de acht
  brontypen één voor één rechtstreeks naar SQLite (`@bvc/cache`'s
  `CacheBuilder`) i.p.v. eerst alle brontypen volledig als objecten in het
  geheugen te verzamelen. `XLSX.read` gebruikt `dense: true` (SheetJS'
  geheugenzuinigere celopslag). Benchmark (168 kolommen, 40.000 rijen,
  320 MB — ruim groter dan een 41 MB productiebestand): ~31 s, ~1,7 GB piek,
  met per-fase logging i.p.v. zonder zichtbaar teken van leven.
- **Robuustheid tegen echte brondata-eigenaardigheden.** Broninventarisatie
  tegen de echte Drive-bronbestanden bracht twee blokkerende bugs aan het
  licht (`coerceDecimal` crashte ongevangen op Excel-foutwaarden als
  `#REF!` — bevestigd in vrijwel elke rij van de echte Boekingen-export;
  begroting-bronnen gebruiken accounting-notatie — komma als
  duizendtalscheider, haakjes voor negatief — die de gedeelde
  decimaalparser verkeerd interpreteerde). Beide gefixt, met regressietests
  op de exacte echte waarden. Zie `packages/tests` voor het volledige
  pre-flight-testdekking.
- **`apps/worker/src/bronAdapter.ts`** — `BronAdapter`-interface: `rebuild-
  cache` haalt rauwe rijen per brontype op via een vervangbare adapter
  (standaard `ExcelBronAdapter`, ook wel "ExcelSource"), nooit
  rechtstreeks via bestandspaden/SheetJS. Voorbereid op een latere
  `InformantOdbcSource` (Informant/PxPlus SQL ODBC — bevestigd
  doelsysteem, huidige driver 32-bit; nog geen 32-bit build/ODBC-code,
  zie CLAUDE.md §4b).
- **`apps/worker/scripts/build-exe.mjs`** — bouwt de Worker als standalone
  `bvc-worker.exe` (Node Single Executable Application): geen Node/pnpm-
  installatie nodig op de doelmachine, zie "Productie-uitvoering" hieronder.

## Productie-uitvoering: standalone .exe, geen Node/pnpm nodig op de server

De bedrijfsomgeving staat geen Node.js/pnpm-installatie op de server toe.
Daarom wordt de Worker in productie gedraaid als **standalone Windows-
executable** (`bvc-worker.exe`), gebouwd met Node's ingebouwde
[Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
(SEA) — de Node-runtime zit in het `.exe`-bestand zelf, er hoeft niets
geïnstalleerd te worden op de doelmachine.

```bash
pnpm --filter @bvc/worker build:exe
# → apps/worker/dist/bvc-worker.exe
```

Werking (zie het script voor de volledige toelichting): esbuild bundelt
`cli.ts` (incl. alle `@bvc/*`-workspacepakketten) tot één bestand → Node
genereert daaruit een SEA-blob → die blob wordt met `postject` in een
kopie van de officiële win-x64 `node.exe` geïnjecteerd (zelfde versie als
de lokale ontwikkel-Node). **Gevalideerd:** dit is end-to-end getest —
`node:sqlite`, `xlsx`, `zod` en `decimal.js` werken allemaal correct
binnen het resulterende `.exe`, inclusief een echte `rebuild-cache`-run
(xlsx inlezen → valideren → SQLite-cache wegschrijven) zonder dat Node
op het systeem geïnstalleerd was.

Aandachtspunten:
- **Ontwikkelen blijft op Node 22** (pnpm, `node:sqlite`) — alleen de
  productie-uitvoering is Node-onafhankelijk, dit vervangt de
  ontwikkelworkflow niet.
- **Ongetekende executable.** Injectie maakt de Authenticode-signature
  van `node.exe` ongeldig. Windows kan een SmartScreen-waarschuwing tonen
  bij de eerste keer uitvoeren; een streng AppLocker/WDAC-beleid dat
  ondertekende executables afdwingt kan het bestand blokkeren. Nog niet
  getest binnen de daadwerkelijke bedrijfs-IT-omgeving — als dat een
  probleem blijkt, is zelf (laten) ondertekenen de vervolgstap.
- **Netwerkschijven/UNC-paden.** `BVC_DATA_ROOT` kan een gemapte
  schijfletter of UNC-pad zijn — standaard Node `fs`-functies (die de
  Worker al overal gebruikt) ondersteunen dat zonder aanpassing.
- **DSN/ODBC later.** Deze packaging-stap raakt niet aan de eerder
  vastgelegde ontwerpregel dat de bronophaal-stap losstaand vervangbaar
  moet zijn (CLAUDE.md §4) — een toekomstige ODBC-bron zou wel een
  ODBC-driver op de doelmachine vereisen, dat is een aparte afweging voor
  wanneer die overstap concreet wordt.

## Wat nadrukkelijk nog NIET gebouwd is

- **PDF/DOCX-export** — rapportsecties zijn nu HTML (BVC-huisstijl); export
  volgt in een latere fase.
- **Koppeling van de KPI-/P&L-rapportsecties aan echte data** — Kerncijfers
  en P&L zijn nog alleen tegen synthetische testcases getest, niet tegen
  een echte `BVC_DATA_ROOT`, en vrijwel elke Kerncijfers-KPI (behalve
  bezettingsgraad) vereist een grootboekmapping die nog niet bestaat —
  zie hieronder. **Wel al gevalideerd tegen echte data**: het
  Controlerapport (`bvc-worker controlerapport <administratieId>`) — een
  rauw brondata-overzicht rechtstreeks uit de cache, bewust zonder
  grootboekmapping, bedoeld om te reconciliëren met een bestaande
  rapportage. Zie `packages/reporting/README.md`.
- **P&L-periodeberekening** (`@bvc/reporting`'s `berekenPlPeriode` +
  `vergelijkMetGereconcilieerd`, `bvc-worker pl-periode
  <administratieId> --boekjaar N --periodeVan P --periodeTotEnMet P
  [--verwacht <json>]`) — de eerste koppeling van de goedgekeurde
  grootboekmapping + expliciete periodeselectie aan een berekening:
  rapportagepost-totalen voor een expliciete boekjaar/boekperiode-range,
  met optionele automatische vergelijking tegen eerder handmatig
  gereconcilieerde bedragen. Bewust alleen rekenkern + vergelijking, geen
  renderer/HTML. Gebouwd en getest (synthetische fixtures) — nog niet
  gedraaid tegen de echte cache van `070_Rooise_Zoom`. Zie
  `packages/reporting/README.md`.
- **`apps/web`** — nog een lege Next.js-scaffold. Wordt het interactieve
  dashboard (met filters), op dezelfde rekenlaag/cache als de HTML/PDF-
  rapporten (CLAUDE.md §3) — nog te bouwen.
- **Volledig P&L-/balansrapport en KPI-koppeling in Kerncijfers.**
  Grootboekmapping, periodefilters, en nu ook de eerste P&L-
  periodeberekening (zie hierboven) staan; wat nog ontbreekt is een
  renderer/HTML-rapport eromheen en de koppeling in Kerncijfers
  (gerealiseerde huurinkomsten/EBITDA/bankstand/debiteuren/servicekosten-
  saldo). De brondata is geen probleem (`Boekingen`/`Balans`/
  `Servicekosten` zijn meerjarige "vanaf 2024"-bestanden) — het
  ontbrekende stuk is de rapportkoppeling/-weergave. `resultaat`
  (nettoresultaat over rapportagecategorieën heen) is bewust nog niet
  geformaliseerd — zie `packages/reporting/README.md`.
- Contract-, huur- en servicekosten-rapportlogica, authenticatie/rollen.
- **Definitieve locatie** van `BVC_DATA_ROOT` en back-upeigenaar — open punt.
- Deze repository blijft voorlopig op GitHub (`Sethos21/BVC-rapportage`,
  waar deze sessie al op werkte toen de "geen nieuwe repo zonder
  goedkeuring"-instructie kwam) — verhuizing naar `BVC-Tools/apps/FinancieelRapport/`
  is een aparte, latere goedkeuringsstap, geen automatisme.

## Lokale ontwikkeling

```bash
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test

# CLI (vereist BVC_DATA_ROOT):
export BVC_DATA_ROOT=/pad/naar/BVC-FinancieelRapport
pnpm --filter @bvc/worker cli init-administratie <administratieId> <bedrijfsnr> <weergavenaam>
pnpm --filter @bvc/worker cli status <administratieId>
pnpm --filter @bvc/worker cli replace boekingen gedeeld /pad/naar/nieuw-bestand.xlsx
pnpm --filter @bvc/worker cli rebuild-cache <administratieId>
pnpm --filter @bvc/worker cli controlerapport <administratieId>   # rauw brondata-overzicht, geschreven naar rapporten/
```

## Herkomst

Broninspectie (kolomkoppen, sleutels, dataconventies) is uitgevoerd tegen
de daadwerkelijke IDBC-exportbestanden uit de Drive-map `03_Databronnen`
van het overdrachtsdossier — niet tegen sjablonen. Zie de Zod-schema's in
`packages/data-contracts/src/sources/*.ts` voor de exacte, geverifieerde
kolomnamen per bron.
