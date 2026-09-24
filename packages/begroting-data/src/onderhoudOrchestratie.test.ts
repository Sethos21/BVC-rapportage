import Decimal from "decimal.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { berekenWerkelijkOnderhoud, type BgOnderhoudKwartaal, type WerkelijkOnderhoudBoekingRegel, type WerkelijkOnderhoudResultaat } from "@bvc/reporting";
import { maakBegrotingsversie, markeerVastgesteld, type Begrotingsversie, type NieuweBegrotingsversieInput } from "./begrotingsversies.js";
import { schrijfCorrectiefDagelijksOnderhoudBeoordeeld } from "./correctiefDagelijksOnderhoudBeoordeeld.js";
import {
  schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels,
  schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen,
  type CorrectiefDagelijksOnderhoudEstimatedOnlyRegel,
  type CorrectiefDagelijksOnderhoudEstimatedVerwachting,
} from "./correctiefDagelijksOnderhoudEstimated.js";
import { leesCorrectiefDagelijksOnderhoudRegels, schrijfCorrectiefDagelijksOnderhoudRegels, type CorrectiefDagelijksOnderhoudRegel } from "./correctiefDagelijksOnderhoudRegels.js";
import { openOrCreateDatabase } from "./database.js";
import { schrijfFrozenCorrectiefDagelijksOnderhoudResultaat } from "./frozenCorrectiefDagelijksOnderhoudResultaat.js";
import { schrijfFrozenGeplandOnderhoudResultaat } from "./frozenGeplandOnderhoudResultaat.js";
import {
  schrijfGeplandOnderhoudEstimatedOnlyActiviteiten,
  schrijfGeplandOnderhoudEstimatedVerwachtingen,
  type GeplandOnderhoudEstimatedOnlyActiviteit,
  type GeplandOnderhoudEstimatedVerwachting,
} from "./geplandOnderhoudEstimated.js";
import { leesGeplandOnderhoudActiviteiten, schrijfGeplandOnderhoudActiviteiten, type GeplandOnderhoudActiviteit } from "./geplandOnderhoudActiviteiten.js";
import { schrijfGeplandOnderhoudBeoordeeld } from "./geplandOnderhoudBeoordeeld.js";
import { berekenCorrectiefDagelijksUitInvoer, berekenGeplandOnderhoudUitInvoer } from "./herberekenen.js";
import { combineerOnderhoudTotaal, leesOnderhoudTotaalResultaat, type OnderhoudOrchestratieInvoer } from "./onderhoudOrchestratie.js";

const ALLE_KWARTALEN: readonly BgOnderhoudKwartaal[] = ["Q1", "Q2", "Q3", "Q4"];

const VERSIE: Begrotingsversie = {
  id: "v-test",
  bedrijfsnr: "070",
  begrotingsjaar: 2026,
  bronPeildatum: new Date(Date.UTC(2026, 5, 30)),
  status: "CONCEPT",
  naam: null,
  notitie: null,
  createdAt: new Date(Date.UTC(2026, 0, 1)),
  vastgesteldAt: null,
  basedOnVersionId: null,
  originType: "NIEUW",
};

function boeking(categorie: WerkelijkOnderhoudBoekingRegel["economischeCategorie"], saldo: number): WerkelijkOnderhoudBoekingRegel {
  return { economischeCategorie: categorie, complexnummer: "003", saldo: new Decimal(saldo) };
}

/** Gebouwen 200 + Terrein 125 + Installaties 75 = moduleTotaal 400. */
function werkelijk400(): WerkelijkOnderhoudResultaat {
  return berekenWerkelijkOnderhoud([boeking("ONDERHOUD_GEBOUWEN", 200), boeking("ONDERHOUD_TERREIN", 125), boeking("ONDERHOUD_INSTALLATIES", 75)]);
}

function activiteit(id: number, overrides: Partial<GeplandOnderhoudActiviteit> = {}): GeplandOnderhoudActiviteit {
  return {
    id,
    complexnummer: "003",
    omschrijving: "Vervangen dakbedekking",
    grootboekrekening: "4300",
    ogbKostensoort: null,
    aanleidingType: "MJOP",
    aanleidingToelichting: "MJOP 2026",
    q1: new Decimal(0),
    q2: new Decimal(0),
    q3: new Decimal(0),
    q4: new Decimal(0),
    status: "GEPLAND",
    leverancier: null,
    offertebedrag: null,
    notitie: null,
    ...overrides,
  };
}

function regel(id: number, overrides: Partial<CorrectiefDagelijksOnderhoudRegel> = {}): CorrectiefDagelijksOnderhoudRegel {
  return { id, omschrijving: "Dagelijks onderhoud", complexnummer: "003", grootboekrekening: "4300", ogbKostensoort: null, jaarbedrag: new Decimal(0), ...overrides };
}

function gVerwachting(activiteitId: number, q1: number, overrides: Partial<GeplandOnderhoudEstimatedVerwachting> = {}): GeplandOnderhoudEstimatedVerwachting {
  return { activiteitId, q1: new Decimal(q1), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0), ...overrides };
}

function cVerwachting(regelId: number, bedrag: number | null): CorrectiefDagelijksOnderhoudEstimatedVerwachting {
  return { regelId, resterendBedrag: bedrag === null ? null : new Decimal(bedrag) };
}

function gEstimatedOnly(id: number, q1: number): GeplandOnderhoudEstimatedOnlyActiviteit {
  return { id, complexnummer: "003", omschrijving: "Onvoorzien", grootboekrekening: "4300", ogbKostensoort: null, q1: new Decimal(q1), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) };
}

function cEstimatedOnly(id: number, bedrag: number | null): CorrectiefDagelijksOnderhoudEstimatedOnlyRegel {
  return { id, omschrijving: "Onvoorzien", complexnummer: null, grootboekrekening: "4300", ogbKostensoort: null, resterendBedrag: bedrag === null ? null : new Decimal(bedrag) };
}

function invoer(overrides: {
  gepland?: GeplandOnderhoudActiviteit[];
  correctief?: CorrectiefDagelijksOnderhoudRegel[];
  gVerw?: GeplandOnderhoudEstimatedVerwachting[];
  gOnly?: GeplandOnderhoudEstimatedOnlyActiviteit[];
  cVerw?: CorrectiefDagelijksOnderhoudEstimatedVerwachting[];
  cOnly?: CorrectiefDagelijksOnderhoudEstimatedOnlyRegel[];
  werkelijk?: WerkelijkOnderhoudResultaat;
} = {}): OnderhoudOrchestratieInvoer {
  return {
    versie: VERSIE,
    geplandBegroting: berekenGeplandOnderhoudUitInvoer(VERSIE.id, VERSIE.begrotingsjaar, overrides.gepland ?? [], true),
    correctiefDagelijksBegroting: berekenCorrectiefDagelijksUitInvoer(VERSIE.id, VERSIE.begrotingsjaar, overrides.correctief ?? [], true),
    geplandEstimatedVerwachtingen: overrides.gVerw ?? [],
    geplandEstimatedOnly: overrides.gOnly ?? [],
    correctiefDagelijksEstimatedVerwachtingen: overrides.cVerw ?? [],
    correctiefDagelijksEstimatedOnly: overrides.cOnly ?? [],
    werkelijk: overrides.werkelijk ?? werkelijk400(),
    resterendeKwartalen: ALLE_KWARTALEN,
  };
}

describe("ID-koppeling Gepland (activiteit_id)", () => {
  it("1. Estimated-restverwachting koppelt via de juiste activiteit_id, ook bij omgekeerde aanlevering", () => {
    const r = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(10), activiteit(20)], gVerw: [gVerwachting(20, 200), gVerwachting(10, 300)] }));
    const perId = new Map(r.gepland.activiteiten.map((a) => [a.activiteitId, a.resterendeVerwachting?.totaal.toString()]));
    expect(perId.get(10)).toBe("300");
    expect(perId.get(20)).toBe("200");
  });

  it("2. omgekeerde arrayvolgorde (Begroting én Estimated) geeft dezelfde inhoudelijke uitkomst", () => {
    const voor = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(10, { q1: new Decimal(5) }), activiteit(20, { q1: new Decimal(7) })], gVerw: [gVerwachting(10, 300), gVerwachting(20, 200)] }));
    const achter = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(20, { q1: new Decimal(7) }), activiteit(10, { q1: new Decimal(5) })], gVerw: [gVerwachting(20, 200), gVerwachting(10, 300)] }));
    const naarMap = (r: typeof voor) => new Map(r.gepland.activiteiten.map((a) => [a.activiteitId, [a.begroting.jaartotaal.toString(), a.resterendeVerwachting?.totaal.toString()]]));
    expect(naarMap(achter)).toEqual(naarMap(voor));
    expect(achter.estimatedOnderhoudTotaal.toString()).toBe(voor.estimatedOnderhoudTotaal.toString());
    expect(achter.begrotingOnderhoudTotaal.toString()).toBe(voor.begrotingOnderhoudTotaal.toString());
  });

  it("3-5. zelfde omschrijving, zelfde bedrag en zelfde grootboek veroorzaken geen verwisseling", () => {
    const identiek = { omschrijving: "Gelijke tekst", grootboekrekening: "4300", q1: new Decimal(100) };
    const r = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(10, identiek), activiteit(20, identiek)], gVerw: [gVerwachting(20, 999), gVerwachting(10, 111)] }));
    expect(r.gepland.activiteiten.find((a) => a.activiteitId === 10)!.resterendeVerwachting!.totaal.toString()).toBe("111");
    expect(r.gepland.activiteiten.find((a) => a.activiteitId === 20)!.resterendeVerwachting!.totaal.toString()).toBe("999");
  });

  it("6. ontbrekende Estimated-restverwachting wordt niet aan een andere activiteit gekoppeld", () => {
    const r = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(10), activiteit(20)], gVerw: [gVerwachting(20, 250)] }));
    expect(r.gepland.activiteiten.find((a) => a.activiteitId === 10)!.resterendeVerwachting).toBeNull();
    expect(r.gepland.activiteiten.find((a) => a.activiteitId === 20)!.resterendeVerwachting!.totaal.toString()).toBe("250");
  });

  it("7. Estimated-only blijft zelfstandig, wordt niet aan Begroting gekoppeld, telt wel mee in resterend", () => {
    const r = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(10)], gOnly: [gEstimatedOnly(1, 100)] }));
    expect(r.gepland.activiteiten[0]!.resterendeVerwachting).toBeNull();
    expect(r.gepland.estimatedOnlyActiviteiten).toHaveLength(1);
    expect(r.gepland.resterendeVerwachtingTotaal.toString()).toBe("100");
  });

  it("orphan Estimated-verwachting (geen Begroting-activiteit) faalt hard, niet stil gedropt", () => {
    expect(() => combineerOnderhoudTotaal(invoer({ gepland: [activiteit(10)], gVerw: [gVerwachting(99, 50)] }))).toThrow(/orphan/);
  });

  it("dubbele Estimated-verwachting voor dezelfde activiteit faalt hard", () => {
    expect(() => combineerOnderhoudTotaal(invoer({ gepland: [activiteit(10)], gVerw: [gVerwachting(10, 1), gVerwachting(10, 2)] }))).toThrow(/meerdere keren/);
  });
});

describe("ID-koppeling Correctief/Dagelijks (regel_id)", () => {
  it("1+2. koppelt via regel_id, omgekeerde volgorde geeft hetzelfde resultaat", () => {
    const a = combineerOnderhoudTotaal(invoer({ correctief: [regel(10), regel(20)], cVerw: [cVerwachting(20, 200), cVerwachting(10, 300)] }));
    const b = combineerOnderhoudTotaal(invoer({ correctief: [regel(20), regel(10)], cVerw: [cVerwachting(10, 300), cVerwachting(20, 200)] }));
    for (const r of [a, b]) {
      expect(r.correctiefDagelijks.regels.find((x) => x.regelId === 10)!.resterendeVerwachting!.bedrag.toString()).toBe("300");
      expect(r.correctiefDagelijks.regels.find((x) => x.regelId === 20)!.resterendeVerwachting!.bedrag.toString()).toBe("200");
    }
    expect(a.estimatedOnderhoudTotaal.toString()).toBe(b.estimatedOnderhoudTotaal.toString());
  });

  it("3-5. zelfde omschrijving/bedrag/grootboek veroorzaken geen verwisseling", () => {
    const identiek = { omschrijving: "Gelijk", grootboekrekening: "4300", jaarbedrag: new Decimal(100) };
    const r = combineerOnderhoudTotaal(invoer({ correctief: [regel(10, identiek), regel(20, identiek)], cVerw: [cVerwachting(20, 999), cVerwachting(10, 111)] }));
    expect(r.correctiefDagelijks.regels.find((x) => x.regelId === 10)!.resterendeVerwachting!.bedrag.toString()).toBe("111");
    expect(r.correctiefDagelijks.regels.find((x) => x.regelId === 20)!.resterendeVerwachting!.bedrag.toString()).toBe("999");
  });

  it("6. ontbrekende Estimated wordt niet aan een andere regel gekoppeld", () => {
    const r = combineerOnderhoudTotaal(invoer({ correctief: [regel(10), regel(20)], cVerw: [cVerwachting(20, 250)] }));
    expect(r.correctiefDagelijks.regels.find((x) => x.regelId === 10)!.resterendeVerwachting).toBeNull();
  });

  it("7. Estimated-only blijft zelfstandig", () => {
    const r = combineerOnderhoudTotaal(invoer({ correctief: [regel(10)], cOnly: [cEstimatedOnly(1, 50)] }));
    expect(r.correctiefDagelijks.regels[0]!.resterendeVerwachting).toBeNull();
    expect(r.correctiefDagelijks.estimatedOnlyRegels).toHaveLength(1);
    expect(r.correctiefDagelijks.resterendeVerwachtingTotaal.toString()).toBe("50");
  });

  it("orphan Estimated-verwachting faalt hard", () => {
    expect(() => combineerOnderhoudTotaal(invoer({ correctief: [regel(10)], cVerw: [cVerwachting(99, 5)] }))).toThrow(/orphan/);
  });
});

describe("Begroting en Estimated hoofdformule (Onderhoud-totaal)", () => {
  const basis = () =>
    invoer({
      gepland: [activiteit(1, { q1: new Decimal(800) })],
      correctief: [regel(1, { jaarbedrag: new Decimal(200) })],
      gVerw: [gVerwachting(1, 500)],
      cVerw: [cVerwachting(1, 200)],
    });

  it("Begroting Gepland 800 + Correctief 200 = Onderhoud 1.000", () => {
    const r = combineerOnderhoudTotaal(basis());
    expect(r.gepland.begrotingTotaal.toString()).toBe("800");
    expect(r.correctiefDagelijks.begrotingTotaal.toString()).toBe("200");
    expect(r.begrotingOnderhoudTotaal.toString()).toBe("1000");
  });

  it("Werkelijk 400 + resterend (500+200=700) = Estimated 1.100, verschil +100, Werkelijk exact éénmaal", () => {
    const r = combineerOnderhoudTotaal(basis());
    expect(r.werkelijk.totaalTotAfgeslotenPeriode.toString()).toBe("400");
    expect(r.resterendeVerwachtingOnderhoudTotaal.toString()).toBe("700");
    expect(r.estimatedOnderhoudTotaal.toString()).toBe("1100"); // niet 1500 (400+400+700) en niet 400+1000
    expect(r.verschilEstimatedVsBegrotingBedrag.toString()).toBe("100");
  });

  it("er bestaat geen werkelijkGepland/werkelijkCorrectief/estimatedGepland/estimatedCorrectief", () => {
    const r = combineerOnderhoudTotaal(basis());
    for (const sleutel of ["werkelijkGepland", "werkelijkCorrectief", "estimatedTotaal", "estimatedGeplandTotaal", "estimatedCorrectiefDagelijksTotaal"]) {
      expect(r).not.toHaveProperty(sleutel);
      expect(r.gepland).not.toHaveProperty(sleutel);
      expect(r.correctiefDagelijks).not.toHaveProperty(sleutel);
    }
    expect(r.gepland).not.toHaveProperty("werkelijk");
    expect(r.correctiefDagelijks).not.toHaveProperty("werkelijk");
  });

  it("Estimated-only Gepland en Correctief tellen mee in resterend en dus in Estimated; Begroting verandert niet", () => {
    const zonder = combineerOnderhoudTotaal(basis());
    const met = combineerOnderhoudTotaal({ ...basis(), geplandEstimatedOnly: [gEstimatedOnly(1, 100)], correctiefDagelijksEstimatedOnly: [cEstimatedOnly(1, 50)] });
    expect(met.gepland.resterendeVerwachtingTotaal.toString()).toBe("600");
    expect(met.correctiefDagelijks.resterendeVerwachtingTotaal.toString()).toBe("250");
    expect(met.estimatedOnderhoudTotaal.toString()).toBe("1250");
    expect(met.begrotingOnderhoudTotaal.toString()).toBe(zonder.begrotingOnderhoudTotaal.toString());
  });

  it("bewust €0 Begroting Gepland en Correctief blijft geldig", () => {
    const r = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(1)], correctief: [regel(1, { jaarbedrag: new Decimal(0) })] }));
    expect(r.begrotingOnderhoudTotaal.toString()).toBe("0");
    expect(r.estimatedOnderhoudTotaal.toString()).toBe("400");
    expect(r.verschilEstimatedVsBegrotingBedrag.toString()).toBe("400");
  });

  it("negatieve resterende verwachting en negatieve Begroting tellen financieel correct mee", () => {
    const r = combineerOnderhoudTotaal(
      invoer({ gepland: [activiteit(1, { q1: new Decimal(-100) })], correctief: [regel(1, { jaarbedrag: new Decimal(-50) })], gVerw: [gVerwachting(1, -30)], cVerw: [cVerwachting(1, -20)] }),
    );
    expect(r.begrotingOnderhoudTotaal.toString()).toBe("-150");
    expect(r.resterendeVerwachtingOnderhoudTotaal.toString()).toBe("-50");
    expect(r.estimatedOnderhoudTotaal.toString()).toBe("350");
  });

  it("expliciet €0 resterend en afwezige (null) resterende verwachting Correctief tellen beide als 0 zonder koppeling", () => {
    const r = combineerOnderhoudTotaal(invoer({ correctief: [regel(1), regel(2)], cVerw: [cVerwachting(1, 0), cVerwachting(2, null)] }));
    expect(r.correctiefDagelijks.regels[0]!.resterendeVerwachting!.invoer.resterendBedrag!.toString()).toBe("0");
    expect(r.correctiefDagelijks.regels[1]!.resterendeVerwachting!.invoer.resterendBedrag).toBeNull();
    expect(r.estimatedOnderhoudTotaal.toString()).toBe("400");
  });

  it("status en OGB beïnvloeden geen financiële optelling", () => {
    const a = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(1, { q1: new Decimal(800), status: "GEPLAND", ogbKostensoort: null })], gVerw: [gVerwachting(1, 500)] }));
    const b = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(1, { q1: new Decimal(800), status: "AFGEROND", ogbKostensoort: "OGB-9" })], gVerw: [gVerwachting(1, 500)] }));
    expect(b.begrotingOnderhoudTotaal.toString()).toBe(a.begrotingOnderhoudTotaal.toString());
    expect(b.estimatedOnderhoudTotaal.toString()).toBe(a.estimatedOnderhoudTotaal.toString());
  });
});

describe("Werkelijk-dimensie (Gebouwen/Terrein/Installaties)", () => {
  it("behoudt de boekhoudkundige uitsplitsing, gebruikt moduleTotaal 400 éénmaal, verdeelt niets over Gepland/Correctief", () => {
    const r = combineerOnderhoudTotaal(invoer({ gepland: [activiteit(1)], correctief: [regel(1)] }));
    const perCategorie = Object.fromEntries(r.werkelijk.perCategorie.map((c) => [c.categorie, c.categorieTotaal.toString()]));
    expect(perCategorie).toEqual({ ONDERHOUD_GEBOUWEN: "200", ONDERHOUD_TERREIN: "125", ONDERHOUD_INSTALLATIES: "75" });
    expect(r.werkelijk.niveau).toBe("ONDERHOUD_TOTAAL");
    expect(r.werkelijk.totaalTotAfgeslotenPeriode.toString()).toBe("400");
    expect(r.estimatedOnderhoudTotaal.toString()).toBe("400");
  });

  it("nietGeclassificeerdTotaal staat buiten moduleTotaal (bestaand contract): doorgegeven, nooit bij Estimated opgeteld", () => {
    const w = berekenWerkelijkOnderhoud([boeking("ONDERHOUD_GEBOUWEN", 400), boeking(null, 50)]);
    const r = combineerOnderhoudTotaal(invoer({ werkelijk: w }));
    expect(r.werkelijk.totaalTotAfgeslotenPeriode.toString()).toBe("400");
    expect(r.werkelijk.nietGeclassificeerdTotaal.toString()).toBe("50");
    expect(r.estimatedOnderhoudTotaal.toString()).toBe("400");
  });
});

describe("Lifecycle (SQLite): frozen Begroting + wijzigbare Estimated", () => {
  let dir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bvc-onderhoud-orchestratie-"));
    db = openOrCreateDatabase(join(dir, "begrotingen.sqlite"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const VERSIE_INPUT: NieuweBegrotingsversieInput = { originType: "NIEUW", bedrijfsnr: "070", begrotingsjaar: 2026, bronPeildatum: new Date(Date.UTC(2026, 5, 30)) };

  function seedConcept(): string {
    const versie = maakBegrotingsversie(db, VERSIE_INPUT);
    const [a, b] = schrijfGeplandOnderhoudActiviteiten(db, versie.id, [
      { ...toInvoer(activiteit(0, { q1: new Decimal(500), omschrijving: "A" })), id: null },
      { ...toInvoer(activiteit(0, { q1: new Decimal(300), omschrijving: "B" })), id: null },
    ]);
    const [r1] = schrijfCorrectiefDagelijksOnderhoudRegels(db, versie.id, [{ id: null, omschrijving: "R", complexnummer: null, grootboekrekening: "4300", ogbKostensoort: null, jaarbedrag: new Decimal(200) }]);
    schrijfGeplandOnderhoudBeoordeeld(db, versie.id, true);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(db, versie.id, true);
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versie.id, [
      { activiteitId: b!.id, q1: new Decimal(111), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) },
      { activiteitId: a!.id, q1: new Decimal(222), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) },
    ]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedVerwachtingen(db, versie.id, [{ regelId: r1!.id, resterendBedrag: new Decimal(70) }]);
    return versie.id;
  }

  function toInvoer(a: GeplandOnderhoudActiviteit) {
    const { id: _id, ...rest } = a;
    return { id: null as number | null, ...rest };
  }

  function bevries(versieId: string): void {
    const versie = { begrotingsjaar: 2026 };
    schrijfFrozenGeplandOnderhoudResultaat(
      db,
      versieId,
      berekenGeplandOnderhoudUitInvoer(versieId, versie.begrotingsjaar, leesGeplandOnderhoudActiviteiten(db, versieId), true),
    );
    schrijfFrozenCorrectiefDagelijksOnderhoudResultaat(
      db,
      versieId,
      berekenCorrectiefDagelijksUitInvoer(versieId, versie.begrotingsjaar, leesCorrectiefDagelijksOnderhoudRegels(db, versieId), true),
    );
    markeerVastgesteld(db, versieId, new Date());
  }

  it("CONCEPT: Begroting uit concept-input + actuele Estimated, gekoppeld via ID", () => {
    const versieId = seedConcept();
    const r = leesOnderhoudTotaalResultaat(db, versieId, werkelijk400(), ALLE_KWARTALEN);
    expect(r.begrotingOnderhoudTotaal.toString()).toBe("1000");
    expect(r.resterendeVerwachtingOnderhoudTotaal.toString()).toBe("403"); // 111+222+70
    expect(r.estimatedOnderhoudTotaal.toString()).toBe("803"); // 400 + 403
    const a = r.gepland.activiteiten.find((x) => x.begroting.invoer.omschrijving === "A")!;
    const b = r.gepland.activiteiten.find((x) => x.begroting.invoer.omschrijving === "B")!;
    expect(a.resterendeVerwachting!.totaal.toString()).toBe("222");
    expect(b.resterendeVerwachting!.totaal.toString()).toBe("111");
  });

  it("VASTGESTELD: Begroting blijft onveranderd, Estimated blijft wijzigbaar en verandert alleen Estimated", () => {
    const versieId = seedConcept();
    const conceptResultaat = leesOnderhoudTotaalResultaat(db, versieId, werkelijk400(), ALLE_KWARTALEN);
    bevries(versieId);

    const vast = leesOnderhoudTotaalResultaat(db, versieId, werkelijk400(), ALLE_KWARTALEN);
    expect(vast.begrotingsversieStatus).toBe("VASTGESTELD");
    expect(vast.begrotingOnderhoudTotaal.toString()).toBe(conceptResultaat.begrotingOnderhoudTotaal.toString());
    expect(vast.estimatedOnderhoudTotaal.toString()).toBe("803");

    // Estimated wijzigen NA vaststellen (toegestaan): andere activiteit-koppeling blijft via ID.
    const actIds = leesGeplandOnderhoudActiviteiten(db, versieId);
    const aId = actIds.find((x) => x.omschrijving === "A")!.id;
    schrijfGeplandOnderhoudEstimatedVerwachtingen(db, versieId, [{ activiteitId: aId, q1: new Decimal(1000), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) }]);
    schrijfGeplandOnderhoudEstimatedOnlyActiviteiten(db, versieId, [{ id: null, complexnummer: "003", omschrijving: "Nieuw", grootboekrekening: "4300", ogbKostensoort: null, q1: new Decimal(25), q2: new Decimal(0), q3: new Decimal(0), q4: new Decimal(0) }]);
    schrijfCorrectiefDagelijksOnderhoudEstimatedOnlyRegels(db, versieId, []);

    const na = leesOnderhoudTotaalResultaat(db, versieId, werkelijk400(), ALLE_KWARTALEN);
    expect(na.begrotingOnderhoudTotaal.toString()).toBe(vast.begrotingOnderhoudTotaal.toString()); // Begroting exact gelijk
    expect(na.gepland.resterendeVerwachtingTotaal.toString()).toBe("1025"); // 1000 (A) + 25 (Estimated-only); B's verwachting is vervangen
    expect(na.estimatedOnderhoudTotaal.toString()).toBe("1495"); // 400 + 1025 + 70
    expect(na.werkelijk.totaalTotAfgeslotenPeriode.toString()).toBe("400"); // bronfeit ongewijzigd
    expect(na.gepland.activiteiten.find((x) => x.activiteitId === aId)!.resterendeVerwachting!.totaal.toString()).toBe("1000");

    // Opnieuw laden levert dezelfde ID-relatie.
    const opnieuw = leesOnderhoudTotaalResultaat(db, versieId, werkelijk400(), ALLE_KWARTALEN);
    expect(opnieuw.estimatedOnderhoudTotaal.toString()).toBe(na.estimatedOnderhoudTotaal.toString());
    expect(opnieuw.gepland.activiteiten.find((x) => x.activiteitId === aId)!.resterendeVerwachting!.totaal.toString()).toBe("1000");
  });

  it("er wordt nooit een frozen-Estimated-tabel aangemaakt of gevuld", () => {
    const versieId = seedConcept();
    bevries(versieId);
    leesOnderhoudTotaalResultaat(db, versieId, werkelijk400(), ALLE_KWARTALEN);
    const tabellen = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%frozen%' AND name LIKE '%estimated%'`).all();
    expect(tabellen).toEqual([]);
  });

  it("lezen schrijft niets: Estimated-tabellen zijn na de orchestratie-leesactie ongewijzigd", () => {
    const versieId = seedConcept();
    const tel = () => (db.prepare(`SELECT COUNT(*) AS n FROM begroting_gepland_onderhoud_estimated_verwachting`).get() as { n: number }).n;
    const voor = tel();
    leesOnderhoudTotaalResultaat(db, versieId, werkelijk400(), ALLE_KWARTALEN);
    expect(tel()).toBe(voor);
  });
});
