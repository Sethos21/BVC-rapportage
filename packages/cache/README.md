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

## `node:sqlite` is experimenteel

Node markeert dit nog als experimenteel (`ExperimentalWarning` bij
gebruik). Gekozen boven `better-sqlite3` omdat het zonder native
build-toolchain werkt op elke werkcomputer met Node 22 — belangrijk voor
een lokale bedrijfsapplicatie zonder centrale installatiebeheer. Mocht de
API instabiel blijken, is `better-sqlite3` de voor de hand liggende
vervanging (zelfde SQL-oppervlak).
