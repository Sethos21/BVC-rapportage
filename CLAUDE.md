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

Zie `README.md` voor de actuele bouwstatus per package en het
overdrachtsdossier voor de volledige historische besluitvorming.
