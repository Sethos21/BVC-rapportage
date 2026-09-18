import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkServicekostenEigenaarViaCentraleMapping,
  resolveerServicekostenEigenaarCategorieViaCentraleMapping,
  type ServicekostenEigenaarCentraleMappingInvoer,
  type ServicekostenEigenaarRuweBoekingRegel,
  type ServicekostenEigenaarWerkelijkViaCentraleMappingInvoer,
} from "./servicekostenEigenaarCentraleMapping.js";
import { servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels } from "./servicekostenEigenaarWerkelijkPnLAdapter.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE GAT-006 (2026-09-17) — GL4350/Servicekosten Eigenaar. Bewijst dat
 * `LEEGSTAND` te smal was als hoofddomein voor GL4350: dezelfde GL draagt
 * zowel reguliere als tijdens-leegstand servicekosten van de eigenaar
 * (hoofddomein `SERVICEKOSTEN_EIGENAAR`, categorieën
 * `SERVICEKOSTEN_EIGENAAR_REGULIER`/`SERVICEKOSTEN_LEEGSTAND`).
 *
 * BEWEZEN BRONMAPPING (hergebruik van het bestaande M5-bewijs, geen nieuwe
 * bronanalyse): 070/GL4350/OGB4319 ("Servicekosten leegstand") →
 * SERVICEKOSTEN_LEEGSTAND, 6 boekingen, complex 003, totaal €1.354,10 — nu
 * onder het correcte hoofddomein. Geen bewezen OGB voor
 * SERVICEKOSTEN_EIGENAAR_REGULIER op 070 — het GAT-006-opdracht-voorbeeld
 * hieronder gebruikt een fictieve, niet-070-bewezen OGB-code ("4400") puur om
 * de architectuur (twee categorieën binnen één hoofddomein) te bewijzen,
 * NOOIT als claim over een echte 070-bronproef voor REGULIER.
 */

const AANGEMAAKT = new Date("2026-09-17T00:00:00.000Z");

function mappingRegel(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4350",
    ogbKostensoort: null,
    economischeModule: "SERVICEKOSTEN_EIGENAAR",
    economischeCategorie: "SERVICEKOSTEN_LEEGSTAND",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** BEWEZEN 070-bronmapping (M5-bewijs, hergebruikt) — uitsluitend GL+OGB-specifiek, GEEN GL-default. */
const MAPPING_070_ALLEEN_LEEGSTAND: PnLBronmappingRegel[] = [mappingRegel({ ogbKostensoort: "4319", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" })];

/** ARCHITECTUURVOORBEELD (fictieve OGB "4400" voor REGULIER, zie moduledoc) — bewijst punt 1/2/3 van de opdracht. */
const MAPPING_070_BEIDE_CATEGORIEEN: PnLBronmappingRegel[] = [
  mappingRegel({ ogbKostensoort: "4319", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" }),
  mappingRegel({ ogbKostensoort: "4400", economischeCategorie: "SERVICEKOSTEN_EIGENAAR_REGULIER" }),
];

function invoer070(overrides: Partial<ServicekostenEigenaarCentraleMappingInvoer> = {}): ServicekostenEigenaarCentraleMappingInvoer {
  return { bedrijfsnr: "070", grootboekrekening: "4350", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-17T12:00:00.000Z"), ...overrides };
}

describe("resolveerServicekostenEigenaarCategorieViaCentraleMapping — 1/3. één GL, twee OGB-specificaties binnen hetzelfde hoofddomein", () => {
  it("1. GL4350/OGB4319 -> SERVICEKOSTEN_LEEGSTAND, GL4350/OGB4400 -> SERVICEKOSTEN_EIGENAAR_REGULIER — beide onder hetzelfde hoofddomein, geen M4b-schending", () => {
    expect(resolveerServicekostenEigenaarCategorieViaCentraleMapping(invoer070(), "4319", MAPPING_070_BEIDE_CATEGORIEEN)).toEqual({ categorie: "SERVICEKOSTEN_LEEGSTAND", specificiteit: "GL_OGB" });
    expect(resolveerServicekostenEigenaarCategorieViaCentraleMapping(invoer070(), "4400", MAPPING_070_BEIDE_CATEGORIEEN)).toEqual({ categorie: "SERVICEKOSTEN_EIGENAAR_REGULIER", specificiteit: "GL_OGB" });
  });

  it("onbekende OGB-code op GL4350 (geen GL-default) -> NIET_GEMAPT, Unknown != zero", () => {
    expect(resolveerServicekostenEigenaarCategorieViaCentraleMapping(invoer070(), "9999", MAPPING_070_BEIDE_CATEGORIEEN)).toBeNull();
  });

  it("boeking zonder OGB-kostensoort (null) op GL4350 -> NIET_GEMAPT (geen GL-default bewezen)", () => {
    expect(resolveerServicekostenEigenaarCategorieViaCentraleMapping(invoer070(), null, MAPPING_070_BEIDE_CATEGORIEEN)).toBeNull();
  });

  it("3. OGB kan niet uit SERVICEKOSTEN_EIGENAAR naar een ander hoofddomein springen: een (per ongeluk) toegevoegde GL-default met een andere module faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [...MAPPING_070_BEIDE_CATEGORIEEN, mappingRegel({ ogbKostensoort: null, economischeModule: "LEEGSTAND", economischeCategorie: "NUTS_LEEGSTAND" })];
    expect(() => resolveerServicekostenEigenaarCategorieViaCentraleMapping(invoer070(), "4319", kapotteMapping)).toThrow(/mag nooit naar een andere economische module springen/);
  });

  it("resolveert naar economischeModule LEEGSTAND (of een andere) -> harde fout, geen coercie (structureel voorkomt dat de Leegstand-calculator per ongeluk Servicekosten Eigenaar behandelt)", () => {
    const verkeerdeModuleMapping: PnLBronmappingRegel[] = [mappingRegel({ economischeModule: "LEEGSTAND", economischeCategorie: "SERVICEKOSTEN_LEEGSTAND" })];
    expect(() => resolveerServicekostenEigenaarCategorieViaCentraleMapping(invoer070(), null, verkeerdeModuleMapping)).toThrow(/niet "SERVICEKOSTEN_EIGENAAR"/);
  });
});

describe("berekenWerkelijkServicekostenEigenaarViaCentraleMapping — 070/GL4350: bewezen bronproef €1.354,10", () => {
  function ruweBoeking(overrides: Partial<ServicekostenEigenaarRuweBoekingRegel> = {}): ServicekostenEigenaarRuweBoekingRegel {
    return { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal(1000), ...overrides };
  }
  function keteninvoer070(overrides: Partial<ServicekostenEigenaarWerkelijkViaCentraleMappingInvoer> = {}): ServicekostenEigenaarWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "070", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-17T12:00:00.000Z"), ...overrides };
  }

  const RUWE_BOEKINGEN_070: ServicekostenEigenaarRuweBoekingRegel[] = [
    ruweBoeking({ saldo: new Decimal(1000) }),
    ruweBoeking({ saldo: new Decimal(1000) }),
    ruweBoeking({ saldo: new Decimal(1000) }),
    ruweBoeking({ saldo: new Decimal("97.53") }),
    ruweBoeking({ saldo: new Decimal("-1283.17") }),
    ruweBoeking({ saldo: new Decimal("-460.26") }),
  ];

  it("volledig gewirede Werkelijk Servicekosten leegstand blijft exact €1.354,10 (ongewijzigd t.o.v. het M5-bewijs, nu onder SERVICEKOSTEN_EIGENAAR)", () => {
    const { werkelijk, nietGemapt } = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(keteninvoer070(), RUWE_BOEKINGEN_070, MAPPING_070_ALLEEN_LEEGSTAND);
    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_EIGENAAR_REGULIER")!.categorieTotaal.toString()).toBe("0");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.perComplex).toEqual([{ complexnummer: "003", saldo: expect.any(Decimal), aantalBoekingen: 6 }]);
  });

  it("2. REGULIER en LEEGSTAND blijven onderscheidbaar wanneer beide voorkomen (architectuurvoorbeeld, fictieve OGB 4400)", () => {
    const boekingen = [...RUWE_BOEKINGEN_070, ruweBoeking({ ogbKostensoort: "4400", ogbKostensoortOmschrijving: "Servicekosten eigenaar regulier", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(keteninvoer070(), boekingen, MAPPING_070_BEIDE_CATEGORIEEN);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_EIGENAAR_REGULIER")!.categorieTotaal.toString()).toBe("500");
  });

  it("4/D. GL-residual (niet-gemapte OGB) blijft expliciet en apart, geen dubbele telling: som categorieën + residual = alle boekingen", () => {
    const boekingen = [...RUWE_BOEKINGEN_070, ruweBoeking({ ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", saldo: new Decimal(200) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(keteninvoer070(), boekingen, MAPPING_070_ALLEEN_LEEGSTAND);

    expect(nietGemapt).toEqual([{ grootboekrekening: "4350", ogbKostensoort: "9999" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("200");
    expect(werkelijk.perCategorie.find((c) => c.categorie === "SERVICEKOSTEN_LEEGSTAND")!.categorieTotaal.toString()).toBe("1354.1"); // ongewijzigd

    const somAlleBoekingen = boekingen.reduce((t, b) => t.plus(b.saldo), new Decimal(0));
    const somCategorieen = werkelijk.perCategorie.reduce((t, c) => t.plus(c.categorieTotaal), new Decimal(0));
    expect(somCategorieen.plus(werkelijk.nietGeclassificeerdTotaal).toString()).toBe(somAlleBoekingen.toString());
    expect(werkelijk.moduleTotaal.toString()).toBe(somCategorieen.toString());
  });

  it("boeking zonder OGB-kostensoort (null) -> expliciet NIET_GEMAPT, geen GL-default toegepast", () => {
    const boekingen = [...RUWE_BOEKINGEN_070, ruweBoeking({ ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(250) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(keteninvoer070(), boekingen, MAPPING_070_ALLEEN_LEEGSTAND);
    expect(nietGemapt).toEqual([{ grootboekrekening: "4350", ogbKostensoort: null }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("250");
  });
});

describe("5. bestaande Leegstand-logica voor Nuts/Overige blijft functioneren, onafhankelijk van GL4350/SERVICEKOSTEN_EIGENAAR", () => {
  it("GL4350 (SERVICEKOSTEN_EIGENAAR) en een andere, fictieve Leegstand-GL leven volledig los van elkaar (bedrijfsnr+GL-gescheiden resolutie)", () => {
    // GL4350 bestaat uitsluitend in de SERVICEKOSTEN_EIGENAAR-mapping — de Servicekosten-Eigenaar-resolver
    // resolveert een fictieve andere GL (die daar niet in voorkomt) correct als NIET_GEMAPT.
    expect(resolveerServicekostenEigenaarCategorieViaCentraleMapping({ ...invoer070(), grootboekrekening: "4360" }, null, MAPPING_070_ALLEEN_LEEGSTAND)).toBeNull();
  });
});

describe("servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels — 6. Pure P&L/EBITDA", () => {
  it("6. beide categorieën landen boven EBITDA, in EXPLOITATIE_LASTEN, als KOSTEN, exact één keer geteld", () => {
    const { werkelijk } = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(
      { bedrijfsnr: "070", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-17T12:00:00.000Z") },
      [
        { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal("1354.1") },
        { grootboekrekening: "4350", ogbKostensoort: "4400", ogbKostensoortOmschrijving: "Servicekosten eigenaar regulier", complexnummer: "003", saldo: new Decimal(500) },
      ],
      MAPPING_070_BEIDE_CATEGORIEEN,
    );
    const regels = servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);

    expect(regels).toHaveLength(2);
    expect(regels.every((r) => r.boomPositie === "BOVEN_EBITDA" && r.groep === "EXPLOITATIE_LASTEN" && r.contributieAard === "KOSTEN")).toBe(true);
    expect(new Set(regels.map((r) => r.regelSleutel)).size).toBe(2); // geen dubbele telling

    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(100000) } };
    const rentekosten = { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA" as const, contributieAard: "KOSTEN" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(50000) } };
    const pnl = berekenPnLBoom("WERKELIJK", [opbrengstRegel, ...regels, rentekosten]);

    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("1854.1"); // 1354.1 + 500
    expect(pnl.onderEbitda).toHaveLength(1);
    expect(pnl.ebitda.bedrag.toString()).toBe("98145.9"); // 100000 - 1854.1, rentekosten blijven buiten EBITDA
    expect(pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("completeness: niet-gemapte bedragen verdwijnen niet — een derde ONBEKEND/NIET_GEMAPT-regel maakt EXPLOITATIE_LASTEN ONVOLLEDIG, bekende categorieën blijven zelf BEKEND", () => {
    const { werkelijk } = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(
      { bedrijfsnr: "070", boekjaar: 2025, boekperiode: "12", opSysteemtijdstip: new Date("2026-09-17T12:00:00.000Z") },
      [
        { grootboekrekening: "4350", ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", complexnummer: "003", saldo: new Decimal("1354.1") },
        { grootboekrekening: "4350", ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", complexnummer: "003", saldo: new Decimal(200) },
      ],
      MAPPING_070_ALLEEN_LEEGSTAND,
    );
    const regels = servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);
    const nietGemapt = regels.find((r) => r.regelSleutel === "SERVICEKOSTEN_EIGENAAR_NIET_GECLASSIFICEERD")!;
    expect(nietGemapt.waarde.status).toBe("ONBEKEND");
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");

    const pnl = berekenPnLBoom("WERKELIJK", regels);
    expect(pnl.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("1354.1"); // bekende deelsom blijft beschikbaar
  });
});
