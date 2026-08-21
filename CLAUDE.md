# BVC Rapportage — uitgangspunten voor elke sessie

Dit document is leidend voor iedereen (mens of AI) die aan deze repository
werkt. Bij twijfel over scope of aanpak: dit document eerst lezen, dan pas
coderen. Achtergrond en volledige geschiedenis staan in `README.md`.

## 1. Deze repository is de projectbasis — de oude code niet

Gebruik deze repository (`Sethos21/BVC-rapportage`) als projectbasis: de
git-geschiedenis blijft staan, dit is niet een nieuw project. Maar **de
oude implementatie (`legacy/index.html`) is nooit de technische basis** —
alleen een **referentie**, en dan uitsluitend visueel/functioneel (welke
secties, welke kaarten/tabellen, welke huisstijl). Elke berekening,
databinding of architectuurkeuze wordt opnieuw en modulair opgebouwd
volgens de architectuur hieronder, nooit door legacy-JS te kopiëren of te
vertalen. Als iets uit legacy wordt overgenomen (CSS-tokens, sectie-
indeling), staat dat expliciet in commit message/README zodat het
traceerbaar blijft als bewust hergebruikte referentie, niet als sluipende
technische afhankelijkheid.

Doel is een **professioneel platform**, geen kloon van de oude tool.

## 2. Strikte scheiding: data / rekenlaag / presentatie

- **Data** (`packages/data-contracts`): parsen en valideren van
  brongegevens (Zod), op de echte geverifieerde kolomnamen. Werkt op
  rijen (objecten), niet op bestanden — zie punt 4.
- **Rekenlaag** (`packages/domain`, en per rapportonderdeel een eigen
  rekenmodule zoals `packages/reporting/src/kerncijfers.ts`): de enige
  plek waar formules staan. Nooit herberekenen of dupliceren in de
  presentatielaag.
- **Presentatie** (`packages/reporting`'s render-modules, `apps/web`):
  rendert alleen, rekent niets uit. Rapport-HTML/PDF en het interactieve
  dashboard zijn **twee outputs van dezelfde rekenlaag** — nooit een eigen
  parallelle berekening in de dashboard-UI.

## 3. Dynamisch, niet hardcoded

- **Config-gestuurd, geen hardcoded uitzonderingen.** Regels als "kostensoort
  9600 altijd uitgesloten" of een norm-percentage horen in een versioned
  parameterbestand (`packages/config`), niet als losse constante in de
  code. Code leest de regel, bepaalt hem niet zelf. Nieuwe uitzonderingen
  of aangepaste normen mogen nooit een codewijziging vereisen.
- **KPI's als losse modules.** Elke KPI (bedrag/percentage + richting/
  gunstig-regel + formaat) is een eigen, herbruikbare bouwsteen — rapport
  en dashboard hergebruiken dezelfde module, geen duplicatie per output.
- **Twee outputs, filters op het dashboard.** Naast het vaste rapport
  (HTML/PDF, huisstijl) komt een interactief dashboard met filters
  (periode, complex, administratie) — beide op dezelfde cache/rekenlaag.

## 4. Bron nu Excel, later makkelijk naar DSN/SQL

Begin met Excel (xlsx) als bron, maar ontwerp zo dat een latere overstap
naar DSN/SQL geen herontwerp is:
- Parsers in `data-contracts` valideren **rijen**, niet bestanden — een
  SQL-query-resultaat kan door dezelfde `parseX(ruweRijen)`-functies.
- Bronophaal (`apps/worker`'s sourceResolver/replace-protocol) mag van
  xlsx-bestandspaden uitgaan, maar die stap moet losstaand vervangbaar
  zijn door een andere bronimplementatie zonder de rest te raken.
- `apps/worker/src/bronAdapter.ts`'s `BronAdapter`-interface is het
  concrete vervangpunt: `rebuildCache` haalt rauwe rijen per brontype op
  via een `BronAdapter` (standaard `ExcelBronAdapter`), nooit rechtstreeks
  via `readFileSync`/SheetJS. Een toekomstige DSN/ODBC-bron is een nieuwe
  klasse die dezelfde interface implementeert; domain/cache/reporting
  blijven ongewijzigd. Getest (`rebuildCache.test.ts`): een fake adapter
  die geen bestand aanraakt bouwt de cache net zo goed op. Bewust
  buiten scope van deze interface: `valideerBron`/het vervangingsprotocol
  (replace.ts) — dat is "valideer en vervang een kandidaat-bestand
  atomisch", een intrinsiek bestandsgericht concept dat voor een live
  DSN-bron niet bestaat (niets om te vervangen, je bevraagt opnieuw).
  Excel en een toekomstige DSN-bron parallel per administratie laten
  draaien (ter vergelijking) is een expliciete wens voor die latere fase,
  nog niet gebouwd — vereist een echt DSN-doelsysteem om tegen te
  ontwerpen/testen.

### 4b. Concreet doelsysteem: Informant/PxPlus SQL ODBC (nog niet gebouwd)

Bevestigd (2026-08-13): het toekomstige DSN-doelsysteem is Informant,
ontsloten via de PxPlus SQL ODBC-driver. Bedrijfsomgeving heeft nu
PxPlus SQL ODBC Driver **v7.00.02.00, 32-bit** geïnstalleerd; de
Informant File DSN's gebruiken deze driver, en Excel op diezelfde
omgeving is ook 32-bit. In `V:\Informant\install\odbc\` staan installers
voor zowel een 32-bit als een 64-bit variant van de driver.

Expliciete beslissing: **geen 32-bit build en geen ODBC-code nu.** De
huidige x64 `bvc-worker.exe`-build (`apps/worker/scripts/build-exe.mjs`)
blijft ongewijzigd. Twee paden worden apart onderzocht (nog geen keuze
gemaakt):
1. of de 64-bit PxPlus-driver rechtstreeks vanuit deze x64 Worker
   bruikbaar is;
2. zo niet (bv. door Informant/PxPlus Views-compatibiliteit), een kleine
   aparte 32-bit ODBC-bridge/hulpproces.

Architectuurbewaking voor wanneer die keuze gemaakt is: de toekomstige
`InformantOdbcSource`/`InformantOdbcBronAdapter` implementeert dezelfde
`BronAdapter`-interface als `ExcelBronAdapter` (zie `bronAdapter.ts`) —
ODBC/PxPlus/bitness-details mogen nooit doorlekken naar domain/cache/
reporting. Een bridge-over-hulpproces is vermoedelijk inherent
asynchroon (`leesRuweRijen` is nu synchroon); die interfacewijziging
wordt pas gemaakt zodra de aanpak zelf gebouwd wordt, niet vooraf
gegokt op een nog onbeslist ontwerp.

## 5. Eén centrale data root, buiten git

`BVC_DATA_ROOT` (env var, geen hardcoded pad) is de enige plek voor
brondata, cache en rapporten — nooit in deze repository. Zie README voor
de volledige mapstructuur, `gedeeld`/`eigen`-bronmodi en het
vervangingsprotocol. Het pad kan een netwerkschijf/UNC-pad zijn.

## 5b. Productie-uitvoering zonder Node/pnpm-installatie

De bedrijfsomgeving staat geen Node.js/pnpm-installatie op de server toe.
`apps/worker` wordt daarom als standalone Windows-executable gedraaid
(`pnpm --filter @bvc/worker build:exe`, Node Single Executable
Applications) — zie README §"Productie-uitvoering" voor de volledige
toelichting en aandachtspunten. Ontwikkelen blijft gewoon op Node 22
(pnpm, `node:sqlite`); alleen de productie-uitvoering is Node-
onafhankelijk. Nieuwe functionaliteit in `apps/worker` moet met deze
packaging-stap blijven werken (geen dynamische `require`/afhankelijkheid
van bestanden buiten de esbuild-bundel).

## 6. Financiële grondslagen (niet onderhandelbaar)

- Nooit `Math.abs()` gebruiken om economische betekenis of balanszijde te
  bepalen; debet/credit blijven gescheiden.
- Onbekende/ambigue waarden: "Controle vereist", nooit gokken of een
  default invullen (`OnbekendOf<T>`-patroon in `@bvc/domain`).
- Grootboekmapping mag alleen `VOORGESTELD` worden geregistreerd, nooit
  `GOEDGEKEURD` — goedkeuring is een menselijke stap.
- **Financiële classificatie loopt altijd via de centrale mapping-/
  configuratielaag** (`@bvc/config`'s grootboekmapping, per administratie
  onder `config/grootboekmappingen/<administratieId>.json` — zie
  `packages/config/README.md`), nooit via een losse if/switch op een
  grootboekrekeningnummer in rapportage- of KPI-code. Dat geldt ook voor de
  tekenconventie (hoe een brondata-saldo naar het gepresenteerde teken van
  een rapportagepost vertaalt): die hoort in de mapping/config, niet in
  presentatiecode. Een niet-gemapte, inactieve, of qua tekenconventie nog
  onbevestigde rekening levert `OnbekendOf`-`onbekend` op, nooit een
  aanname of stilzwijgende 0/factor-1.
- **Periodekeuze is altijd expliciet.** Eén grootboekrekening kan meerdere
  balansstanden/periodewaarden hebben (bevestigd via het Controlerapport op
  de echte cache van `070_Rooise_Zoom`) — data-/rapportagecode mag daarom
  nooit impliciet de eerste/laatste/willekeurige rij gebruiken. Selecteer
  altijd expliciet op minimaal administratie + boekjaar + boekperiode(-range)
  + grootboekrekening (zie `@bvc/cache`'s `periodeSelectie.ts`). Kan de
  gevraagde periodegranulariteit (nog) niet betrouwbaar geleverd worden
  (bv. balans op een specifieke boekperiode — de cache heeft alleen een
  jaareindsaldo), dan is het antwoord expliciet `onbekend`, nooit een
  stilzwijgende benadering met een andere periode.

Zie `README.md` voor de actuele bouwstatus per package en het
overdrachtsdossier voor de volledige historische besluitvorming.

## 7. Lokale omgeving & workflow

### VS Code setup

- Claude Code-extensie geïnstalleerd (Anthropic, v2.1.238).
- WSL Integration uitgeschakeld — gebruik altijd PowerShell, geen bash/WSL.
- GitHub MCP ingesteld via `mcp.json` (HTTP-transport,
  `https://api.githubcopilot.com/mcp`).
- Standaard terminal: PowerShell.

### Build & deploy workflow

- Lokale repo: `C:\Users\seth\BVC-rapportage-claude`.
- Build commando: `corepack pnpm --filter @bvc/worker build:exe` (zie §5b).
- Output: `C:\Users\seth\BVC-rapportage-claude\apps\worker\dist\bvc-worker.exe`.
- Na build automatisch kopiëren naar:
  `\\BERNHEZE-DC01\gebruikers$\seth\Documents\Claude Desktop\PROJECTEN\Worker\`
  — dat is de plek van waaruit de gebruiker de `.exe` daadwerkelijk draait.
  Elke schema-/logicawijziging in `apps/worker` (of een package die het
  bundelt) vereist een nieuwe build + kopieerstap; de oude `.exe` op de
  netwerklocatie wordt nooit automatisch bijgewerkt.

### Rapport genereren

- `BVC_DATA_ROOT`: `M:\Werk\werk BVC - BEHEER\Beheer commercieel og\BVC
  Financiele Rapportage Tool\BVC_DATA_ROOT` (env var, zie §5 — dit is de
  waarde op deze werkplek, niet een hardcoded pad in code).
- De Worker draait de gebruiker zelf, op de netwerklocatie, via een aparte
  PowerShell-sessie — niet vanuit deze devcontainer/sessie (geen toegang
  tot `BVC_DATA_ROOT` of het netwerkpad vanuit hier).
- Commando: `.\bvc-worker.exe rapport-periode <administratieId> --boekjaar
  <jaar> --periodeTotEnMet <periode>` (zie ook `pl-periode`/
  `balans-periode`/`controlerapport` voor de losse onderdelen, packages/
  reporting/README.md).

