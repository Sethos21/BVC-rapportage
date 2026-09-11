import type { DatabaseSync } from "node:sqlite";
import type { BgBeheerResultaat, BgHuurResultaat, BgManagementResultaat } from "@bvc/reporting";
import { leesBegrotingsversie, markeerVastgesteld, type Begrotingsversie } from "./begrotingsversies.js";
import {
  schrijfFrozenAlgemeneKostenResultaatZonderTransactie,
  type FrozenAlgemeneKostenResultaat,
} from "./frozenAlgemeneKostenResultaat.js";
import { schrijfFrozenCorrectiefDagelijksOnderhoudResultaatZonderTransactie } from "./frozenCorrectiefDagelijksOnderhoudResultaat.js";
import {
  schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie,
  type FrozenGemeentelijkeLastenResultaat,
} from "./frozenGemeentelijkeLastenResultaat.js";
import { schrijfFrozenGeplandOnderhoudResultaatZonderTransactie } from "./frozenGeplandOnderhoudResultaat.js";
import { schrijfFrozenLeegstandResultaatZonderTransactie, type FrozenLeegstandResultaat } from "./frozenLeegstandResultaat.js";
import { schrijfFrozenModule3ResultaatZonderTransactie } from "./frozenModule3Resultaat.js";
import { schrijfFrozenRenteResultaatZonderTransactie, type FrozenRenteResultaat } from "./frozenRenteResultaat.js";
import { schrijfFrozenBegrotingsresultaatZonderTransactie } from "./frozenResultaat.js";
import { schrijfFrozenVerzekeringResultaatZonderTransactie } from "./frozenVerzekeringResultaat.js";
import {
  berekenBegrotingUitInvoer,
  leesHerberekenInvoerZonderTransactie,
  type HerberekendCorrectiefDagelijksResultaat,
  type HerberekendGeplandOnderhoudResultaat,
  type HerberekendVerzekeringResultaat,
} from "./herberekenen.js";

/**
 * De atomaire VASTSTELLEN-operatie (Fase 1D.6b, uitgebreid met Module 3 in
 * Fase 2C.5, met Gepland Onderhoud in fase GO-P3 en met Correctief/Dagelijks
 * Onderhoud in fase CD-P3) — de enige plek waar een CONCEPT-begrotingsversie
 * definitief VASTGESTELD wordt. Eén complete SQLite-schrijftransactie:
 * dezelfde persistente input lezen als `herberekenBegroting`, exact dezelfde
 * pure Module-1/2/3-, Gepland-Onderhoud- en Correctief/Dagelijks-Onderhoud-
 * berekening uitvoeren, dat resultaat als frozen output opslaan
 * (`schrijfFrozenBegrotingsresultaatZonderTransactie` voor Module 1/2,
 * `schrijfFrozenModule3ResultaatZonderTransactie` voor Module 3,
 * `schrijfFrozenGeplandOnderhoudResultaatZonderTransactie` voor Gepland
 * Onderhoud, `schrijfFrozenCorrectiefDagelijksOnderhoudResultaatZonderTransactie`
 * voor Correctief/Dagelijks Onderhoud — alle vier bestaande mappings,
 * ongewijzigd, geen tweede mapping), en pas als allerlaatste schrijfactie de
 * status omzetten (`markeerVastgesteld`, het bestaande 1D.2-bouwblok). Faalt
 * één van deze stappen, dan rolt de VOLLEDIGE transactie terug: geen
 * gedeeltelijke frozen output (voor geen van de modules), geen gedeeltelijke
 * statuswijziging, de versie blijft exact zoals vóór de poging.
 *
 * BUSINESSBESLISSING (2026-09-03/04, fase 2C.1/2C.5-review): Module-3-invoer
 * is bij CONCEPT-herberekening optioneel (`HerberekendeBegroting.module3:
 * BgManagementResultaat | null`), maar bij VASTSTELLEN VERPLICHT — een
 * versie mag nooit vastgesteld worden zonder dat de gebruiker Module 3
 * expliciet heeft beoordeeld (ook al leidt die beoordeling tot €0). Vandaar
 * dat `VastgesteldeBegroting.module3` hier bewust NIET-nullable is
 * (`BgManagementResultaat`, geen `| null`) — semantisch onderscheiden van
 * `HerberekendeBegroting.module3`, die dat onderscheid voor CONCEPT juist
 * WEL moet kunnen tonen. Ontbrekende Module-3-invoer wordt hier nooit
 * geïnterpreteerd als €0/default-invoer/lege frozen output — het is een
 * blokkerende fout, vóór enige berekening of schrijfactie.
 *
 * GEPLAND ONDERHOUD (fase GO-P3, businessbeslissing 2026-09-04): UITSLUITEND
 * voor Gepland Onderhoud geldt vanaf nu een NIEUWE, LOKALE vaststel-blokkade
 * — expliciet NIET een generieke regel die voor Module 1/2/3 zou gelden
 * (die behouden hun bestaande, ongewijzigde "`controleVereist` blokkeert
 * nooit"-semantiek, zie hierboven). Vaststellen wordt geblokkeerd als:
 * (a) `geplandOnderhoud.beoordeeld !== true` — "nog niet beoordeeld", exact
 * dezelfde soort blokkade als Module 3's "geen invoer"-check hierboven, maar
 * dan op de al-berekende `beoordeeld`-vlag i.p.v. op "ontbrekende rij"; of
 * (b) `geplandOnderhoud.controleVereist` bevat één of meer `KRITIEK`-items.
 * WAARSCHUWING/INFORMATIEF blokkeren niet (zelfde vocabulaire-behandeling
 * als Module 1/2/3, alleen `KRITIEK` is hier voor het eerst een
 * vaststel-blokkade). Deze twee checks zijn de ENIGE nieuwe validatielogica
 * — beide lezen uitsluitend het al door `berekenBegrotingUitInvoer`
 * berekende `geplandOnderhoud`-resultaat, er wordt niets herberekend of
 * dubbel gevalideerd (complexnummer/omschrijving/aanleidingType/status/
 * bedragen blijven uitsluitend de verantwoordelijkheid van de pure
 * calculator, zie `begroteGeplandOnderhoud.ts`).
 *
 * CORRECTIEF/DAGELIJKS ONDERHOUD (fase CD-P3, businessbeslissing 2026-09-07):
 * volgt EXACT hetzelfde lokale-blokkade-patroon als Gepland Onderhoud
 * hierboven — geen generieke "alle KRITIEK uit alle modules blokkeren"-
 * refactor, Module 1/2/3 en Gepland Onderhoud behouden hun bestaande,
 * ongewijzigde semantiek. Vaststellen wordt geblokkeerd als:
 * (a) `correctiefDagelijksOnderhoud.beoordeeld !== true`; of
 * (b) `correctiefDagelijksOnderhoud.controleVereist` bevat één of meer
 * `KRITIEK`-items. WAARSCHUWING/INFORMATIEF blokkeren niet. Deze twee checks
 * lezen uitsluitend het al door `berekenBegrotingUitInvoer` berekende
 * `correctiefDagelijksOnderhoud`-resultaat — er wordt niets herberekend of
 * dubbel gevalideerd (omschrijving/complexnummer/jaarbedrag blijven
 * uitsluitend de verantwoordelijkheid van de pure calculator, zie
 * `begroteCorrectiefDagelijksOnderhoud.ts`). Dit was de tweede lokale
 * uitzondering op de Module-1/2/3-regel dat `controleVereist` nooit
 * blokkeert.
 *
 * VERZEKERINGEN (OB-032, businessbeslissingen OB032-001 t/m 013): volgt
 * EXACT hetzelfde lokale-blokkade-patroon als Gepland Onderhoud/
 * Correctief-Dagelijks Onderhoud hierboven — de DERDE lokale uitzondering.
 * Vaststellen wordt geblokkeerd als:
 * (a) `verzekering.beoordeeld !== true`; of
 * (b) `verzekering.controleVereist` bevat één of meer `KRITIEK`-items
 * (waaronder een ontbrekend complexnummer/verzekeraar — OB032-002/009 —
 * en elk van de vier rekenkritische velden). WAARSCHUWING/INFORMATIEF
 * blokkeren niet. Deze twee checks lezen uitsluitend het al door
 * `berekenBegrotingUitInvoer` berekende `verzekering`-resultaat — er wordt
 * niets herberekend of dubbel gevalideerd (zie `begroteVerzekeringen.ts`).
 *
 * GEMEENTELIJKE LASTEN / WOZ (OB-033, fase P3): volgt EXACT hetzelfde
 * lokale-blokkade-patroon — de VIERDE en (tot nu toe) laatste lokale
 * uitzondering. Vaststellen wordt geblokkeerd als:
 * (a) `gemeentelijkeLasten.beoordeeld !== true`; of
 * (b) `gemeentelijkeLasten.controleVereist` bevat één of meer `KRITIEK`-
 * items. WAARSCHUWING/INFORMATIEF blokkeren niet. Dit maakt
 * `REVIEWED_ZERO_OBJECTS` (`beoordeeld=true`, 0 WOZ-objecten, eventueel
 * alle module-aannames `null`, uitsluitend de zero-object-WAARSCHUWING —
 * zie de OB033-016-correctie in `begroteGemeentelijkeLasten.ts`) een
 * bewust geldige, vaststelbare toestand: er is dan geen KRITIEK, dus geen
 * blokkade. `>=1 WOZ-object met totaleWerkelijkeWoz = 0` blijft wél
 * blokkeren — dat IS een KRITIEK (dezelfde generieke regel (b), geen
 * aparte derde check). Deze twee checks lezen uitsluitend het al door
 * `berekenBegrotingUitInvoer` berekende `gemeentelijkeLasten`-resultaat —
 * er wordt niets herberekend of dubbel gevalideerd (zie
 * `begroteGemeentelijkeLasten.ts`). Frozen output bevat, naast het
 * berekende resultaat, ook de apart doorgegeven
 * `invoer.gemeentelijkeLastenModule.werkelijkeGemeentelijkeLasten` (zie
 * `frozenGemeentelijkeLastenResultaat.ts`'s moduledoc — die aanname wordt
 * door de pure calculator zelf niet teruggegeven).
 *
 * ALGEMENE KOSTEN (OB-035/036, fase P3): volgt hetzelfde lokale-blokkade-
 * patroon — de VIJFDE en (tot nu toe) laatste lokale uitzondering, met ÉÉN
 * verschil in vorm: de blokkade geldt PER CATEGORIE (vijf onafhankelijke
 * checks, niet één). Vaststellen wordt geblokkeerd als:
 * (a) een willekeurige van de vijf categorieën `beoordeeld !== true` heeft
 * (ALLE vijf moeten expliciet beoordeeld zijn — Accountant bewust op €0
 * terwijl Juridische kosten nog niet behandeld is, blokkeert dus terecht);
 * of (b) `algemeneKosten.controleVereist` (over alle categorieën heen) bevat
 * één of meer `KRITIEK`-items. WAARSCHUWING/INFORMATIEF blokkeren niet. Dit
 * maakt `REVIEWED_ZERO_RULES` per categorie een bewust geldige, vaststelbare
 * toestand: 0 regels + `beoordeeld=true` geeft geen enkele KRITIEK. Deze
 * twee checks lezen uitsluitend het al door `berekenBegrotingUitInvoer`
 * berekende `algemeneKosten`-resultaat — er wordt niets herberekend of
 * dubbel gevalideerd (zie `begroteAlgemeneKosten.ts`). Frozen output bevat,
 * naast het berekende resultaat, ook de volledige resolved lokale
 * classificatie (`invoer.algemeneKostenClassificatie`, administratie-breed,
 * GEEN begrotingsversie-gebonden data — zie
 * `frozenAlgemeneKostenResultaat.ts`'s moduledoc).
 *
 * LEEGSTANDSKOSTEN (OB-031, fase P3): volgt exact hetzelfde per-categorie-
 * lokale-blokkade-patroon als Algemene Kosten — ALLE DRIE categorieën
 * (`beoordeeld !== true` op één van de drie blokkeert) en GEEN `KRITIEK` in
 * `leegstand.controleVereist`. ANDERS dan Algemene Kosten wordt hier GEEN
 * classificatie meebevroren — een Leegstand-begrotingsregel heeft geen
 * OGB-koppeling (zie `frozenLeegstandResultaat.ts`'s moduledoc); de lokale
 * leegstand-classificatie wordt uitsluitend door de losstaande, nooit
 * gepersisteerde Werkelijk-berekening gebruikt en blijft hier volledig
 * buiten beeld.
 *
 * Bundelt uitsluitend de al bestaande `Begrotingsversie`/`BgHuurResultaat`/
 * `BgBeheerResultaat`/`BgManagementResultaat`/`HerberekendGeplandOnderhoudResultaat`/
 * `HerberekendCorrectiefDagelijksResultaat`/`HerberekendVerzekeringResultaat`/
 * `FrozenGemeentelijkeLastenResultaat`/`FrozenAlgemeneKostenResultaat`/
 * `FrozenLeegstandResultaat` — bewust geen shadow-rekenresultaattype.
 */
export interface VastgesteldeBegroting {
  versie: Begrotingsversie;
  module1: BgHuurResultaat;
  module2: BgBeheerResultaat;
  module3: BgManagementResultaat;
  geplandOnderhoud: HerberekendGeplandOnderhoudResultaat;
  correctiefDagelijksOnderhoud: HerberekendCorrectiefDagelijksResultaat;
  verzekering: HerberekendVerzekeringResultaat;
  gemeentelijkeLasten: FrozenGemeentelijkeLastenResultaat;
  algemeneKosten: FrozenAlgemeneKostenResultaat;
  leegstand: FrozenLeegstandResultaat;
  rente: FrozenRenteResultaat;
}

/**
 * `BEGIN IMMEDIATE` (niet het gewone `BEGIN`/`BEGIN DEFERRED` dat elders in
 * dit package wordt gebruikt voor reads en voor de op-zichzelf-staande
 * schrijfoperaties zoals `schrijfModule1Snapshot`): deze transactie
 * verwerft meteen bij `BEGIN` het schrijfslot, in plaats van pas bij de
 * eerste feitelijke schrijfstatement. Reden, specifiek voor vaststellen:
 * twee gelijktijdige vaststelpogingen op DEZELFDE CONCEPT-versie mogen
 * nooit allebei eerst de volledige (niet-triviale) berekening uitvoeren
 * tegen een CONCEPT-snapshot die door de ander al aan het wijzigen is naar
 * VASTGESTELD. Met `BEGIN IMMEDIATE` wacht de tweede poging (via de
 * bestaande `busy_timeout = 5000` uit 1D.1) op het schrijfslot van de
 * eerste; komt ze daarna aan de beurt, leest ze de dan-al-VASTGESTELDE
 * status opnieuw en weigert via de bestaande statuscheck — nooit een
 * dubbele, race-gevoelige vaststelling. Geen zwaardere locking-
 * infrastructuur nodig; dit is precies waarvoor `BEGIN IMMEDIATE` bestaat.
 */
function withWriteTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultaat = fn();
    db.exec("COMMIT");
    return resultaat;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Stelt begrotingsversie `versieId` definitief vast. Zie moduledoc voor de
 * volledige atomaire flow. `vastgesteldAt` is optioneel — ontbreekt hij, dan
 * wordt `new Date()` exact ÉÉN keer aangeroepen op dit niveau en voor zowel
 * de DB-statusupdate als de geretourneerde versie gebruikt (nooit twee
 * losse `new Date()`-aanroepen die subtiel uiteen zouden kunnen lopen).
 *
 * Alleen CONCEPT mag worden vastgesteld — een niet-bestaande of al
 * VASTGESTELDE versie geeft een duidelijke fout (via
 * `leesHerberekenInvoerZonderTransactie`, dezelfde statuscheck als
 * `herberekenBegroting`; geen tweede, dubbele precheck). Geen idempotente
 * "nogmaals vaststellen" — een tweede poging op een inmiddels VASTGESTELDE
 * versie faalt hard, ongeacht of het resultaat toevallig identiek zou zijn.
 *
 * Bestaande, tijdelijke frozen output van CONCEPT (indien aanwezig) wordt
 * altijd volledig vervangen door een verse berekening tegen de HUIDIGE
 * persistente input op het moment van vaststellen — nooit blind
 * geaccepteerd als definitief.
 *
 * `controleVereist`-items van Module 1/2/3 blokkeren vaststellen NIET —
 * alleen een daadwerkelijke pure-laag-exceptie (fail-fast) stopt de
 * operatie; dat is de bestaande, ongewijzigde semantiek van die drie pure
 * functies (zie `berekenBegrotingUitInvoer`), hier niet opnieuw
 * geïnterpreteerd. Module 3 volgt hierin exact dezelfde, al goedgekeurde
 * conventie als Module 1/2 — geen nieuwe, strengere regel specifiek voor
 * Module 3 geïntroduceerd. De enige nieuwe blokkade vóór GO-P3 was de
 * expliciete afwezigheid van Module-3-invoer zelf, niet de inhoud van een
 * eenmaal aanwezige invoer. Gepland Onderhoud (GO-P3), Correctief/
 * Dagelijks Onderhoud (CD-P3) en, sinds OB-032, Verzekeringen (zie
 * moduledoc hierboven) zijn de ENIGE drie plekken waar een
 * `KRITIEK`-`controleVereist`-item daadwerkelijk vaststellen blokkeert —
 * elk een bewuste, lokale uitzondering op deze verder ongewijzigde regel,
 * nooit veralgemeniseerd naar Module 1/2/3.
 */
export function stelBegrotingVast(db: DatabaseSync, versieId: string, vastgesteldAt: Date = new Date()): VastgesteldeBegroting {
  return withWriteTransaction(db, () => {
    const invoer = leesHerberekenInvoerZonderTransactie(db, versieId);
    if (invoer.module3Invoer === null) {
      throw new Error(
        `Begrotingsversie ${versieId}: geen Module-3-invoer (Managementvergoeding) opgeslagen — vaststellen is zonder Module-3-invoer niet mogelijk. Ontbrekende invoer betekent "nog niet beoordeeld", nooit €0.`,
      );
    }

    const { module1, module2, module3, geplandOnderhoud, correctiefDagelijksOnderhoud, verzekering, gemeentelijkeLasten, algemeneKosten, leegstand, rente } =
      berekenBegrotingUitInvoer(versieId, invoer);
    // Lokale, expliciete narrowing: `module3` is hier altijd niet-null, want `invoer.module3Invoer !== null`
    // is hierboven al gecontroleerd en `berekenBegrotingUitInvoer` berekent Module 3 uitsluitend (en dan
    // altijd naar een niet-null resultaat) wanneer `module3Invoer` niet-null is. Deze check is dus puur
    // voor TypeScript's typesysteem — in de praktijk onbereikbaar, geen nieuwe businessregel.
    if (module3 === null) {
      throw new Error(
        `Interne fout: begrotingsversie ${versieId}: Module-3-resultaat is null ondanks gecontroleerde, niet-lege invoer — interne inconsistentie.`,
      );
    }

    // Gepland-Onderhoud-lifecycle-validatie (GO-P3, zie moduledoc) — UITSLUITEND lokaal voor Gepland
    // Onderhoud, wijzigt niets aan hoe Module 1/2/3's eigen controleVereist wordt behandeld hierboven/onder.
    if (!geplandOnderhoud.beoordeeld) {
      throw new Error(
        `Begrotingsversie ${versieId}: Gepland Onderhoud is niet beoordeeld (beoordeeld !== true) — vaststellen is niet mogelijk zonder expliciete beoordeling.`,
      );
    }
    if (geplandOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK")) {
      throw new Error(
        `Begrotingsversie ${versieId}: Gepland Onderhoud bevat één of meer KRITIEKE controls — vaststellen is niet mogelijk vóórdat deze zijn opgelost.`,
      );
    }

    // Correctief/Dagelijks-Onderhoud-lifecycle-validatie (CD-P3, zie moduledoc) — UITSLUITEND lokaal voor
    // Correctief/Dagelijks Onderhoud, wijzigt niets aan hoe Module 1/2/3's/Gepland Onderhoud's eigen
    // controleVereist wordt behandeld hierboven.
    if (!correctiefDagelijksOnderhoud.beoordeeld) {
      throw new Error(
        `Begrotingsversie ${versieId}: Correctief/Dagelijks Onderhoud is niet beoordeeld (beoordeeld !== true) — vaststellen is niet mogelijk zonder expliciete beoordeling.`,
      );
    }
    if (correctiefDagelijksOnderhoud.controleVereist.some((c) => c.ernst === "KRITIEK")) {
      throw new Error(
        `Begrotingsversie ${versieId}: Correctief/Dagelijks Onderhoud bevat één of meer KRITIEKE controls — vaststellen is niet mogelijk vóórdat deze zijn opgelost.`,
      );
    }

    // Verzekeringen-lifecycle-validatie (OB-032, zie moduledoc) — UITSLUITEND lokaal voor Verzekeringen,
    // wijzigt niets aan hoe Module 1/2/3's/Gepland Onderhoud's/Correctief-Dagelijks Onderhoud's eigen
    // controleVereist wordt behandeld hierboven.
    if (!verzekering.beoordeeld) {
      throw new Error(
        `Begrotingsversie ${versieId}: Verzekeringen is niet beoordeeld (beoordeeld !== true) — vaststellen is niet mogelijk zonder expliciete beoordeling.`,
      );
    }
    if (verzekering.controleVereist.some((c) => c.ernst === "KRITIEK")) {
      throw new Error(
        `Begrotingsversie ${versieId}: Verzekeringen bevat één of meer KRITIEKE controls — vaststellen is niet mogelijk vóórdat deze zijn opgelost.`,
      );
    }

    // Gemeentelijke-Lasten/WOZ-lifecycle-validatie (OB-033, fase P3, zie moduledoc) — UITSLUITEND lokaal voor
    // Gemeentelijke Lasten/WOZ, wijzigt niets aan hoe de eerdere modules' eigen controleVereist wordt
    // behandeld hierboven. REVIEWED_ZERO_OBJECTS blijft expliciet vaststelbaar: bij 0 WOZ-objecten bevat
    // controleVereist (sinds de OB033-016-correctie) geen KRITIEK, uitsluitend de zero-object-WAARSCHUWING.
    if (!gemeentelijkeLasten.beoordeeld) {
      throw new Error(
        `Begrotingsversie ${versieId}: Gemeentelijke Lasten/WOZ is niet beoordeeld (beoordeeld !== true) — vaststellen is niet mogelijk zonder expliciete beoordeling.`,
      );
    }
    if (gemeentelijkeLasten.controleVereist.some((c) => c.ernst === "KRITIEK")) {
      throw new Error(
        `Begrotingsversie ${versieId}: Gemeentelijke Lasten/WOZ bevat één of meer KRITIEKE controls — vaststellen is niet mogelijk vóórdat deze zijn opgelost.`,
      );
    }

    // Algemene-Kosten-lifecycle-validatie (OB-035/036, fase P3, zie moduledoc) — UITSLUITEND lokaal voor
    // Algemene Kosten, wijzigt niets aan hoe de eerdere modules' eigen controleVereist wordt behandeld
    // hierboven. PER CATEGORIE: ALLE vijf moeten expliciet beoordeeld=true zijn (Accountant bewust op €0
    // terwijl Juridische kosten nog niet behandeld is, blokkeert dus terecht op de laatste).
    const nietBeoordeeldeCategorie = algemeneKosten.perCategorie.find((c) => !c.beoordeeld);
    if (nietBeoordeeldeCategorie !== undefined) {
      throw new Error(
        `Begrotingsversie ${versieId}: Algemene Kosten — categorie ${nietBeoordeeldeCategorie.categorie} is niet beoordeeld (beoordeeld !== true) — vaststellen is niet mogelijk zonder expliciete beoordeling van ALLE vijf categorieën.`,
      );
    }
    if (algemeneKosten.controleVereist.some((c) => c.ernst === "KRITIEK")) {
      throw new Error(
        `Begrotingsversie ${versieId}: Algemene Kosten bevat één of meer KRITIEKE controls — vaststellen is niet mogelijk vóórdat deze zijn opgelost.`,
      );
    }

    // Leegstand-lifecycle-validatie (OB-031, fase P3, zie moduledoc) — UITSLUITEND lokaal voor
    // Leegstandskosten, wijzigt niets aan hoe de eerdere modules' eigen controleVereist wordt behandeld
    // hierboven. PER CATEGORIE: ALLE drie moeten expliciet beoordeeld=true zijn.
    const nietBeoordeeldeLeegstandCategorie = leegstand.perCategorie.find((c) => !c.beoordeeld);
    if (nietBeoordeeldeLeegstandCategorie !== undefined) {
      throw new Error(
        `Begrotingsversie ${versieId}: Leegstandskosten — categorie ${nietBeoordeeldeLeegstandCategorie.categorie} is niet beoordeeld (beoordeeld !== true) — vaststellen is niet mogelijk zonder expliciete beoordeling van ALLE drie categorieën.`,
      );
    }
    if (leegstand.controleVereist.some((c) => c.ernst === "KRITIEK")) {
      throw new Error(
        `Begrotingsversie ${versieId}: Leegstandskosten bevat één of meer KRITIEKE controls — vaststellen is niet mogelijk vóórdat deze zijn opgelost.`,
      );
    }

    // Rente-lifecycle-validatie (OB-037/038, fase P3, zie moduledoc) — UITSLUITEND lokaal voor Rente,
    // wijzigt niets aan hoe de eerdere modules' eigen controleVereist wordt behandeld hierboven. PER
    // CATEGORIE: BEIDE (Rentekosten + Rente opbrengsten) moeten expliciet beoordeeld=true zijn.
    const nietBeoordeeldeRenteCategorie = rente.perCategorie.find((c) => !c.beoordeeld);
    if (nietBeoordeeldeRenteCategorie !== undefined) {
      throw new Error(
        `Begrotingsversie ${versieId}: Rente — categorie ${nietBeoordeeldeRenteCategorie.categorie} is niet beoordeeld (beoordeeld !== true) — vaststellen is niet mogelijk zonder expliciete beoordeling van BEIDE categorieën.`,
      );
    }
    if (rente.controleVereist.some((c) => c.ernst === "KRITIEK")) {
      throw new Error(`Begrotingsversie ${versieId}: Rente bevat één of meer KRITIEKE controls — vaststellen is niet mogelijk vóórdat deze zijn opgelost.`);
    }

    schrijfFrozenBegrotingsresultaatZonderTransactie(db, versieId, { module1, module2 });
    schrijfFrozenModule3ResultaatZonderTransactie(db, versieId, module3);
    schrijfFrozenGeplandOnderhoudResultaatZonderTransactie(db, versieId, geplandOnderhoud);
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaatZonderTransactie(db, versieId, correctiefDagelijksOnderhoud);
    schrijfFrozenVerzekeringResultaatZonderTransactie(db, versieId, verzekering);
    schrijfFrozenGemeentelijkeLastenResultaatZonderTransactie(db, versieId, gemeentelijkeLasten, invoer.gemeentelijkeLastenModule.werkelijkeGemeentelijkeLasten);
    schrijfFrozenAlgemeneKostenResultaatZonderTransactie(db, versieId, algemeneKosten, invoer.algemeneKostenClassificatie);
    schrijfFrozenLeegstandResultaatZonderTransactie(db, versieId, leegstand);
    schrijfFrozenRenteResultaatZonderTransactie(db, versieId, rente);
    markeerVastgesteld(db, versieId, vastgesteldAt); // allerlaatste schrijfactie vóór commit

    const versie = leesBegrotingsversie(db, versieId);
    if (versie === null) {
      throw new Error(`Interne fout: begrotingsversie ${versieId} kon direct na vaststellen niet worden teruggelezen.`);
    }

    const frozenGemeentelijkeLasten: FrozenGemeentelijkeLastenResultaat = {
      ...gemeentelijkeLasten,
      werkelijkeGemeentelijkeLasten: invoer.gemeentelijkeLastenModule.werkelijkeGemeentelijkeLasten,
    };
    const frozenAlgemeneKosten: FrozenAlgemeneKostenResultaat = {
      ...algemeneKosten,
      classificatie: invoer.algemeneKostenClassificatie,
    };

    return {
      versie,
      module1,
      module2,
      module3,
      geplandOnderhoud,
      correctiefDagelijksOnderhoud,
      verzekering,
      gemeentelijkeLasten: frozenGemeentelijkeLasten,
      algemeneKosten: frozenAlgemeneKosten,
      leegstand,
      rente,
    };
  });
}
