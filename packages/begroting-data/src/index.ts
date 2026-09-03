// `runMigrations`/`MIGRATIONS`/`Migration` (migrations.js) zijn BEWUST niet
// hier publiek herexporteerd — de injecteerbare migratielijst van
// `runMigrations` is uitsluitend een testbaarheidshaak (zie migrations.test.ts,
// die er via het relatieve pad "./migrations.js" bij kan) en geen bedoelde
// business-API. `openOrCreateDatabase` is het enige publieke toegangspunt
// voor de database zelf.
export * from "./database.js";

// `markeerVastgesteld` (begrotingsversies.js) is BEWUST niet hier
// herexporteerd — het is een intern lifecycle-bouwblok. Sinds Fase 1D.6b
// wordt het daadwerkelijk gebruikt door `stelBegrotingVast`
// (vaststellen.js, hieronder) binnen diens ene atomaire transactie; de
// publieke ingang blijft `stelBegrotingVast` zelf, nooit `markeerVastgesteld`
// rechtstreeks. Eerdere fases' tests importeren het nog steeds rechtstreeks
// via "./begrotingsversies.js" om de immutability-invariant te bewijzen.
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

// Zelfde principe: `BgHuurAannames`, `BgContractOverride`/`BgOverrideScope`
// en `BgBeheerComplexConfig` komen rechtstreeks uit `@bvc/reporting` —
// geen shadow-types in dit package.
export { schrijfModule1Aannames, leesModule1Aannames } from "./module1Aannames.js";
export { schrijfModule1Overrides, leesModule1Overrides } from "./module1Overrides.js";
export { schrijfModule2Config, leesModule2Config } from "./module2Config.js";

// Orchestratie (uitsluitend lezen + pure berekening, GEEN schrijfeffecten) —
// bundelt de al bestaande `Begrotingsversie`/`BgHuurResultaat`/`BgBeheerResultaat`,
// geen shadow-rekenresultaattype.
export { herberekenBegroting, type HerberekendeBegroting } from "./herberekenen.js";

// Bevroren Module-1/Module-2-output (1D.6a) — uitsluitend serialisatie/
// deserialisatie van de bestaande `BgHuurResultaat`/`BgBeheerResultaat`,
// geen shadow-resultaattype. `schrijfFrozenBegrotingsresultaatZonderTransactie`
// blijft bewust intern (zie vaststellen.js) — de publieke schrijf-ingang is
// en blijft `schrijfFrozenBegrotingsresultaat`.
export { schrijfFrozenBegrotingsresultaat, leesFrozenBegrotingsresultaat, type FrozenBegrotingsresultaat } from "./frozenResultaat.js";

// De atomaire VASTSTELLEN-operatie (1D.6b) — de enige publieke weg om een
// CONCEPT-versie definitief VASTGESTELD te maken. Bundelt uitsluitend de
// bestaande `Begrotingsversie`/`BgHuurResultaat`/`BgBeheerResultaat`.
export { stelBegrotingVast, type VastgesteldeBegroting } from "./vaststellen.js";
