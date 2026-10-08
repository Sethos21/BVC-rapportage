# @bvc/cache

Lokale, volledig herbouwbare cache (SQLite via het ingebouwde `node:sqlite`
in Node 22 — geen native compile-stap, belangrijk voor installatie op
verschillende werkcomputers). Dit is **geen** systeem-van-record: de
actuele bronbestanden (xlsx, per administratie geresolved via
`apps/worker`) blijven leidend. Zie de root-README voor waarom dit
project geen PostgreSQL/cloud-database meer gebruikt.

## Ontwerp

- **Eén cache-bestand per administratie** (`administraties/<id>/cache/cache.sqlite`).
- **Geen migraties.** Elke herbouw (`buildCache`) maakt alle tabellen
  opnieuw aan in een tijdelijk bestand en vervangt het cache-bestand pas
  na succes atomisch (`rename`). Bij een fout blijft een eventueel
  bestaand cache-bestand ongewijzigd.
- **Geen historie.** De cache bevat alleen de laatst herbouwde staat —
  precies zoals de bronbestanden zelf ook geen historische versies bewaren.
- **Geldbedragen als TEXT** (decimal.js-string), nooit als SQLite `REAL`
  (IEEE754 floating point), om drijvendekommafouten te vermijden.

## Periodefilters (`periodeSelectie.ts`) — expliciete periodeselectie

De rapportagelaag mag nooit impliciet de eerste/laatste/willekeurige rij
gebruiken wanneer één grootboekrekening meerdere balansstanden/
periodewaarden heeft (dit bleek concreet uit het Controlerapport op de
echte cache van `070_Rooise_Zoom`). `periodeSelectie.ts` biedt daarom de
generieke, herbruikbare selectiefuncties waarmee toekomstige P&L-/
balansrapportage ondubbelzinnig data opvraagt — dit bestand bouwt zelf
nog geen P&L of balansrapport, alleen de selectielaag.

- **`selecteerBoekingen(rows, { bedrijfsnr, boekjaar, boekperiodeVan?,
  boekperiodeTotEnMet?, grootboekrekening? })`** — selecteert op
  administratie + boekjaar + optionele inclusieve boekperiode-range (bv.
  `boekperiodeVan: "01", boekperiodeTotEnMet: "06"` voor "periode 1 t/m
  6") + optionele grootboekrekening. Dit dekt P&L-achtige selecties zoals
  "boekjaar 2026 periode 1 t/m 6" en "boekjaar 2025 periode 1 t/m 6".
  Boekperiodes zijn 2-cijferige strings (`"01".."12"`); lexicografische
  vergelijking is hier geldig omdat alle broncontracten deze vaste breedte
  al garanderen. Zonder boekperiode-opgave gelden alle boekperioden van het
  boekjaar — dat is een expliciete keuze van de aanroeper ("heel het
  boekjaar"), nooit een impliciete fallback.
- **`selecteerBalansstanden(rows, { bedrijfsnr, jaar, grootboekrekening?
  })`** — selecteert het jaar-`eindsaldo` per grootboekrekening. **Bekende
  beperking:** de `balansstanden`-tabel heeft geen peildatum-kolom; voor
  een afgesloten boekjaar is `eindsaldo` vermoedelijk het jaareindsaldo,
  maar voor een nog lopend boekjaar is niet uit de rij zelf af te leiden op
  welke datum/periode dat saldo daadwerkelijk betrekking heeft. Gebruik
  deze functie dus nooit om een claim over "saldo op peildatum X" te
  onderbouwen.
- **`selecteerBalansOpBoekperiode(rows, { bedrijfsnr, jaar, boekperiode,
  grootboekrekening? })`** — voor een expliciete vraag als "balans einde
  periode 6 van 2026". Geeft **altijd** `OnbekendOf`-`onbekend` terug: de
  bron bevat wel 15 periodeparen debet/credit (zie
  `packages/data-contracts/src/sources/balans.ts`), maar die zijn nog niet
  individueel in het cache-schema gemodelleerd (`balansstanden` heeft
  alleen een jaar-kolom). Dit vereist een Worker-cache-schemawijziging,
  bewust buiten scope van de bouwstap die deze functie toevoegde. De
  functie bestaat nu al zodat toekomstige rapportcode één vaste, expliciete
  ingang heeft — en nooit stilzwijgend `selecteerBalansstanden`s
  jaareindsaldo als vervanging gebruikt.

## `node:sqlite` is experimenteel

Node markeert dit nog als experimenteel (`ExperimentalWarning` bij
gebruik). Gekozen boven `better-sqlite3` omdat het zonder native
build-toolchain werkt op elke werkcomputer met Node 22 — belangrijk voor
een lokale bedrijfsapplicatie zonder centrale installatiebeheer. Mocht de
API instabiel blijken, is `better-sqlite3` de voor de hand liggende
vervanging (zelfde SQL-oppervlak).
