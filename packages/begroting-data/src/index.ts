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

// Zelfde principe voor Module 3 (Managementvergoeding, fase 2C.2):
// `BgManagementInvoer` komt rechtstreeks uit `@bvc/reporting` — geen
// shadow-type hier. `leesModule3Invoer` geeft `null` terug als er nog geen
// invoer is opgeslagen — dat is een eigen, betekenisvolle "nog niet
// beoordeeld"-toestand, nooit een impliciet €0-resultaat (zie module3Invoer.js).
export { schrijfModule3Invoer, leesModule3Invoer } from "./module3Invoer.js";

// Orchestratie (uitsluitend lezen + pure berekening, GEEN schrijfeffecten) —
// bundelt de al bestaande `Begrotingsversie`/`BgHuurResultaat`/`BgBeheerResultaat`,
// geen shadow-rekenresultaattype. `HerberekendGeplandOnderhoudResultaat`/
// `GeplandOnderhoudActiviteitUitkomstMetId` (GO-P2) zijn de enige uitzondering:
// begroting-data-eigen wrappers om `BgGeplandOnderhoudResultaat` heen, uitsluitend
// om een persistentie-ID aan elke activiteit-uitkomst te koppelen — zie
// herberekenen.js's moduledoc.
export {
  herberekenBegroting,
  type HerberekendeBegroting,
  type HerberekendGeplandOnderhoudResultaat,
  type GeplandOnderhoudActiviteitUitkomstMetId,
  type HerberekendCorrectiefDagelijksResultaat,
  type CorrectiefDagelijksRegelUitkomstMetId,
  type HerberekendVerzekeringResultaat,
  type VerzekeringRegelUitkomstMetId,
  type HerberekendGemeentelijkeLastenResultaat,
  type WozObjectUitkomstMetId,
  type HerberekendAlgemeneKostenResultaat,
  type HerberekendAlgemeneKostenCategorieResultaat,
  type AlgemeneKostenRegelUitkomstMetId,
  type HerberekendLeegstandResultaat,
  type HerberekendLeegstandCategorieResultaat,
  type LeegstandRegelUitkomstMetId,
  type HerberekendRenteResultaat,
  type HerberekendRenteCategorieResultaat,
  type RenteRegelUitkomstMetId,
} from "./herberekenen.js";

// Bevroren Module-1/Module-2-output (1D.6a) — uitsluitend serialisatie/
// deserialisatie van de bestaande `BgHuurResultaat`/`BgBeheerResultaat`,
// geen shadow-resultaattype. `schrijfFrozenBegrotingsresultaatZonderTransactie`
// blijft bewust intern (zie vaststellen.js) — de publieke schrijf-ingang is
// en blijft `schrijfFrozenBegrotingsresultaat`.
export { schrijfFrozenBegrotingsresultaat, leesFrozenBegrotingsresultaat, type FrozenBegrotingsresultaat } from "./frozenResultaat.js";

// Bevroren Module-3-output (fase 2C.4) — uitsluitend serialisatie/
// deserialisatie van de bestaande `BgManagementResultaat`, geen
// shadow-resultaattype. Strikt gescheiden van `module3Invoer.js` (de
// persistente INVOER): deze laag leest die tabel nooit terug om een
// resultaat te reconstrueren. `schrijfFrozenModule3ResultaatZonderTransactie`
// blijft bewust intern (zelfde grens als `schrijfFrozenBegrotingsresultaat
// ZonderTransactie`) — de publieke schrijf-ingang is en blijft
// `schrijfFrozenModule3Resultaat`. `leesFrozenModule3Resultaat` geeft `null`
// terug als er nog geen frozen output is — nooit een default/`Decimal(0)`.
export { schrijfFrozenModule3Resultaat, leesFrozenModule3Resultaat } from "./frozenModule3Resultaat.js";

// Bevroren Gepland-Onderhoud-output (fase GO-P3) — uitsluitend serialisatie/
// deserialisatie van de bestaande `HerberekendGeplandOnderhoudResultaat`,
// geen shadow-resultaattype. Strikt gescheiden van
// `geplandOnderhoudActiviteiten.js`/`geplandOnderhoudBeoordeeld.js` (de
// persistente CONCEPT-input): deze laag leest die tabellen nooit terug om
// een resultaat te reconstrueren. `schrijfFrozenGeplandOnderhoudResultaat
// ZonderTransactie` blijft bewust intern (zelfde grens als de Module-3-
// variant) — de publieke schrijf-ingang is en blijft
// `schrijfFrozenGeplandOnderhoudResultaat`.
export { schrijfFrozenGeplandOnderhoudResultaat, leesFrozenGeplandOnderhoudResultaat } from "./frozenGeplandOnderhoudResultaat.js";

// Bevroren Correctief/Dagelijks-Onderhoud-output (fase CD-P3) — uitsluitend
// serialisatie/deserialisatie van de bestaande
// `HerberekendCorrectiefDagelijksResultaat`, geen shadow-resultaattype.
// Strikt gescheiden van `correctiefDagelijksOnderhoudRegels.js`/
// `correctiefDagelijksOnderhoudBeoordeeld.js` (de persistente CONCEPT-
// input): deze laag leest die tabellen nooit terug om een resultaat te
// reconstrueren. `schrijfFrozenCorrectiefDagelijksOnderhoudResultaat
// ZonderTransactie` blijft bewust intern (zelfde grens als de GO-variant)
// — de publieke schrijf-ingang is en blijft
// `schrijfFrozenCorrectiefDagelijksOnderhoudResultaat`.
export {
  schrijfFrozenCorrectiefDagelijksOnderhoudResultaat,
  leesFrozenCorrectiefDagelijksOnderhoudResultaat,
} from "./frozenCorrectiefDagelijksOnderhoudResultaat.js";

// Bevroren Verzekeringen-output (OB-032) — uitsluitend serialisatie/
// deserialisatie van de bestaande `HerberekendVerzekeringResultaat`, geen
// shadow-resultaattype. Strikt gescheiden van `verzekeringRegels.js`/
// `verzekeringBeoordeeld.js` (de persistente CONCEPT-input).
// `schrijfFrozenVerzekeringResultaatZonderTransactie` blijft bewust intern
// — de publieke schrijf-ingang is en blijft `schrijfFrozenVerzekeringResultaat`.
export { schrijfFrozenVerzekeringResultaat, leesFrozenVerzekeringResultaat } from "./frozenVerzekeringResultaat.js";

// Bevroren Gemeentelijke-Lasten/WOZ-output (OB-033, fase P3) — uitsluitend
// serialisatie/deserialisatie van de bestaande `HerberekendGemeentelijkeLastenResultaat`,
// aangevuld met de apart bevroren `werkelijkeGemeentelijkeLasten` (geen
// onderdeel van de pure calculator se returntype, zie
// `frozenGemeentelijkeLastenResultaat.ts`'s moduledoc) — geen shadow-
// resultaattype voor de rest. Strikt gescheiden van
// `gemeentelijkeLastenModule.ts`/`wozObjecten.ts` (de persistente CONCEPT-
// input): deze laag leest die tabellen nooit terug om een resultaat te
// reconstrueren. `schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie`
// blijft bewust intern — de publieke schrijf-ingang is en blijft
// `schrijfFrozenGemeentelijkeLastenResultaat`.
export {
  schrijfFrozenGemeentelijkeLastenResultaat,
  leesFrozenGemeentelijkeLastenResultaat,
  type FrozenGemeentelijkeLastenResultaat,
} from "./frozenGemeentelijkeLastenResultaat.js";

// Bevroren Algemene-Kosten-output (OB-035/036, fase P3) — uitsluitend
// serialisatie/deserialisatie van de bestaande `HerberekendAlgemeneKostenResultaat`,
// aangevuld met de volledige resolved lokale classificatie zoals die gold op
// het moment van vaststellen (zie `frozenAlgemeneKostenResultaat.ts`'s
// moduledoc). Strikt gescheiden van `algemeneKostenClassificatie.ts`/
// `algemeneKostenCategorieState.ts`/`algemeneKostenRegels.ts` (de levende
// classificatieconfiguratie resp. de persistente CONCEPT-input): deze laag
// leest die tabellen nooit terug om een resultaat te reconstrueren.
// `schrijfFrozenAlgemeneKostenResultaatZonderTransactie` blijft bewust
// intern — de publieke schrijf-ingang is en blijft
// `schrijfFrozenAlgemeneKostenResultaat`.
export {
  schrijfFrozenAlgemeneKostenResultaat,
  leesFrozenAlgemeneKostenResultaat,
  type FrozenAlgemeneKostenResultaat,
} from "./frozenAlgemeneKostenResultaat.js";

// Bevroren Leegstandskosten-output (OB-031, fase P3) — uitsluitend
// serialisatie/deserialisatie van het bestaande `HerberekendLeegstandResultaat`
// (uitsluitend de Begroting-kant — Werkelijk/Estimated worden per ontwerp
// NOOIT bevroren, zie `frozenLeegstandResultaat.ts`'s moduledoc). Strikt
// gescheiden van `leegstandRegels.ts`/`leegstandCategorieState.ts` (de
// persistente CONCEPT-input): deze laag leest die tabellen nooit terug om
// een resultaat te reconstrueren. `schrijfFrozenLeegstandResultaatZonderTransactie`
// blijft bewust intern — de publieke schrijf-ingang is en blijft
// `schrijfFrozenLeegstandResultaat`.
export {
  schrijfFrozenLeegstandResultaat,
  leesFrozenLeegstandResultaat,
  type FrozenLeegstandResultaat,
} from "./frozenLeegstandResultaat.js";

// Bevroren Rente-output (OB-037/038, fase P3) — uitsluitend serialisatie/
// deserialisatie van het bestaande `HerberekendRenteResultaat` (uitsluitend
// de Begroting-kant — Werkelijk/Estimated worden per ontwerp NOOIT
// bevroren, zie `frozenRenteResultaat.ts`'s moduledoc). Strikt gescheiden
// van `renteRegels.ts`/`renteCategorieState.ts` (de persistente CONCEPT-
// input): deze laag leest die tabellen nooit terug om een resultaat te
// reconstrueren. `schrijfFrozenRenteResultaatZonderTransactie` blijft
// bewust intern — de publieke schrijf-ingang is en blijft
// `schrijfFrozenRenteResultaat`.
export {
  schrijfFrozenRenteResultaat,
  leesFrozenRenteResultaat,
  type FrozenRenteResultaat,
} from "./frozenRenteResultaat.js";

// De atomaire VASTSTELLEN-operatie (1D.6b) — de enige publieke weg om een
// CONCEPT-versie definitief VASTGESTELD te maken. Bundelt uitsluitend de
// bestaande `Begrotingsversie`/`BgHuurResultaat`/`BgBeheerResultaat`/
// `HerberekendGeplandOnderhoudResultaat`/`HerberekendCorrectiefDagelijksResultaat`.
export { stelBegrotingVast, type VastgesteldeBegroting } from "./vaststellen.js";

// Gepland Onderhoud — fase GO-P1, UITSLUITEND concept-persistence (geen
// pure-calculator-integratie in dit bestand zelf; herberekening/frozen output
// zitten in herberekenen.js/frozenGeplandOnderhoudResultaat.js hierboven).
// Bewust GEEN `@bvc/reporting`-enum-types hier hergebruikt — zie
// `geplandOnderhoudActiviteiten.ts`'s moduledoc.
export {
  schrijfGeplandOnderhoudActiviteiten,
  leesGeplandOnderhoudActiviteiten,
  type GeplandOnderhoudActiviteit,
  type GeplandOnderhoudActiviteitInvoer,
} from "./geplandOnderhoudActiviteiten.js";
export { schrijfGeplandOnderhoudBeoordeeld, leesGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";

// Correctief/Dagelijks Onderhoud (OB-028) — fase CD-P1, UITSLUITEND concept-
// persistence (geen pure-calculator-integratie in dit bestand zelf;
// herberekening zit in herberekenen.js hierboven — CD-P3/frozen output volgt
// pas in een latere, apart te reviewen fase). Bewust GEEN
// `@bvc/reporting`-types hier hergebruikt voor dezelfde reden als
// `geplandOnderhoudActiviteiten.ts` — zie `correctiefDagelijksOnderhoudRegels.ts`'s
// moduledoc.
export {
  schrijfCorrectiefDagelijksOnderhoudRegels,
  leesCorrectiefDagelijksOnderhoudRegels,
  type CorrectiefDagelijksOnderhoudRegel,
  type CorrectiefDagelijksOnderhoudRegelInvoer,
} from "./correctiefDagelijksOnderhoudRegels.js";
export {
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
  leesCorrectiefDagelijksOnderhoudBeoordeeld,
} from "./correctiefDagelijksOnderhoudBeoordeeld.js";

// Verzekeringen (OB-032) — UITSLUITEND concept-persistence (geen
// pure-calculator-integratie in dit bestand zelf; herberekening/frozen
// output zitten in herberekenen.js/frozenVerzekeringResultaat.js). Bewust
// GEEN `@bvc/reporting`-types hier hergebruikt voor dezelfde reden als de
// andere begrotingsposten — zie `verzekeringRegels.ts`'s moduledoc.
export {
  schrijfVerzekeringRegels,
  leesVerzekeringRegels,
  type VerzekeringRegel,
  type VerzekeringRegelInvoer,
} from "./verzekeringRegels.js";
export { schrijfVerzekeringBeoordeeld, leesVerzekeringBeoordeeld } from "./verzekeringBeoordeeld.js";

// Gemeentelijke lasten / WOZ (OB-033) — fase P1, UITSLUITEND concept-
// persistence (geen pure-calculator-integratie in dit bestand zelf;
// herberekening zit in herberekenen.js). Bewust ÉÉN gecombineerd
// module-bestand voor aannames + beoordeeld — zie
// `gemeentelijkeLastenModule.ts`'s moduledoc.
export {
  schrijfGemeentelijkeLastenModule,
  leesGemeentelijkeLastenModule,
  type GemeentelijkeLastenModuleInvoer,
} from "./gemeentelijkeLastenModule.js";
export { schrijfWozObjecten, leesWozObjecten, type WozObject, type WozObjectInvoer } from "./wozObjecten.js";

// Algemene kosten (OB-035/036) — fase P1, UITSLUITEND concept-persistence
// (geen pure-calculator-integratie in dit bestand zelf; herberekening/frozen
// output zitten in herberekenen.js/frozenAlgemeneKostenResultaat.js). De
// lokale OGB-classificatie (`algemeneKostenClassificatie.ts`) is bewust
// ADMINISTRATIE-BREED (sleutel `bedrijfsnr`), niet begrotingsversie-
// gebonden — zie dat bestand se moduledoc.
export {
  schrijfAlgemeneKostenClassificatie,
  leesAlgemeneKostenClassificatie,
  type AlgemeneKostenClassificatieRegel,
} from "./algemeneKostenClassificatie.js";
export {
  schrijfAlgemeneKostenCategorieState,
  leesAlgemeneKostenCategorieState,
  type AlgemeneKostenCategorieStateInvoer,
} from "./algemeneKostenCategorieState.js";
export {
  schrijfAlgemeneKostenRegels,
  leesAlgemeneKostenRegels,
  type AlgemeneKostenRegel,
  type AlgemeneKostenRegelInvoer,
} from "./algemeneKostenRegels.js";

// Leegstandskosten (OB-031) — fase P1, UITSLUITEND concept-persistence
// (geen pure-calculator-integratie in dit bestand zelf; herberekening/frozen
// output zitten in herberekenen.js/frozenLeegstandResultaat.js). De lokale
// OGB-classificatie (`leegstandClassificatie.ts`) is bewust ADMINISTRATIE-
// BREED (sleutel `bedrijfsnr`), niet begrotingsversie-gebonden — zie dat
// bestand se moduledoc. Werkelijk/Estimated worden NOOIT gepersisteerd (zie
// `@bvc/reporting`'s `begroteLeegstand.ts`) — uitsluitend de Begroting-kant
// heeft persistence/frozen-lifecycle.
export {
  schrijfLeegstandClassificatie,
  leesLeegstandClassificatie,
  type LeegstandClassificatieRegel,
} from "./leegstandClassificatie.js";
export {
  schrijfLeegstandCategorieState,
  leesLeegstandCategorieState,
  type LeegstandCategorieStateInvoer,
} from "./leegstandCategorieState.js";
export {
  schrijfLeegstandRegels,
  leesLeegstandRegels,
  type LeegstandRegel,
  type LeegstandRegelInvoer,
} from "./leegstandRegels.js";

// Rente (OB-037 Rentekosten / OB-038 Rente opbrengsten) — fase P1,
// UITSLUITEND concept-persistence (geen pure-calculator-integratie in dit
// bestand zelf; herberekening/frozen output zitten in
// herberekenen.js/frozenRenteResultaat.js). De lokale OGB-classificatie
// (`renteClassificatie.ts`) is bewust ADMINISTRATIE-BREED (sleutel
// `bedrijfsnr`), niet begrotingsversie-gebonden, en NOOIT portfolio-breed
// (bewezen: dezelfde OGB-code kan tussen administraties tegengestelde
// betekenissen hebben) — zie dat bestand se moduledoc. Werkelijk/Estimated
// worden NOOIT gepersisteerd (zie `@bvc/reporting`'s `begroteRente.ts`).
export {
  schrijfRenteClassificatie,
  leesRenteClassificatie,
  type RenteClassificatieRegel,
} from "./renteClassificatie.js";
export {
  schrijfRenteCategorieState,
  leesRenteCategorieState,
  type RenteCategorieStateInvoer,
} from "./renteCategorieState.js";
export {
  schrijfRenteRegels,
  leesRenteRegels,
  type RenteRegel,
  type RenteRegelInvoer,
} from "./renteRegels.js";
