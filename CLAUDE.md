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

## 5. Eén centrale data root, buiten git

`BVC_DATA_ROOT` (env var, geen hardcoded pad) is de enige plek voor
brondata, cache en rapporten — nooit in deze repository. Zie README voor
de volledige mapstructuur, `gedeeld`/`eigen`-bronmodi en het
vervangingsprotocol.

## 6. Financiële grondslagen (niet onderhandelbaar)

- Nooit `Math.abs()` gebruiken om economische betekenis of balanszijde te
  bepalen; debet/credit blijven gescheiden.
- Onbekende/ambigue waarden: "Controle vereist", nooit gokken of een
  default invullen (`OnbekendOf<T>`-patroon in `@bvc/domain`).
- Grootboekmapping mag alleen `VOORGESTELD` worden geregistreerd, nooit
  `GOEDGEKEURD` — goedkeuring is een menselijke stap.

Zie `README.md` voor de actuele bouwstatus per package en het
overdrachtsdossier voor de volledige historische besluitvorming.
