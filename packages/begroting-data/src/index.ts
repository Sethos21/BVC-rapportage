// `runMigrations`/`MIGRATIONS`/`Migration` (migrations.js) zijn BEWUST niet
// hier publiek herexporteerd — de injecteerbare migratielijst van
// `runMigrations` is uitsluitend een testbaarheidshaak (zie migrations.test.ts,
// die er via het relatieve pad "./migrations.js" bij kan) en geen bedoelde
// business-API. `openOrCreateDatabase` is het enige publieke toegangspunt
// voor de database zelf.
export * from "./database.js";

// `markeerVastgesteld` (begrotingsversies.js) is BEWUST niet hier
// herexporteerd — het is een intern lifecycle-bouwblok, gereserveerd voor de
// échte VASTSTELLEN-transactie van Fase 1D.6 (die Module 1/2 berekent, frozen
// output schrijft, én deze statusovergang uitvoert, alles atomair). Deze
// fase's eigen tests importeren hem rechtstreeks via "./begrotingsversies.js".
export {
  maakBegrotingsversie,
  leesBegrotingsversie,
  wijzigConceptNaamNotitie,
  verwijderConceptVersie,
  type Begrotingsversie,
  type BegrotingsversieStatus,
  type BegrotingsversieOriginType,
  type NieuweBegrotingsversieInput,
} from "./begrotingsversies.js";

// De Module-1-snapshot zelf is uitsluitend `BgContractFeiten[]` (uit
// `@bvc/reporting`) — geen eigen, gedupliceerd type hier. Consumers
// importeren `BgContractFeiten`/`BgRentrollComponent`/
// `BgToekomstigeKortingswijziging` rechtstreeks vanuit `@bvc/reporting`.
export { schrijfModule1Snapshot, leesModule1Snapshot } from "./module1Snapshot.js";
