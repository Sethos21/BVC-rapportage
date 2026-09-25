import { describe, expect, it } from "vitest";
import { resolveerPnLBronmapping, type PnLBronmappingRegel, type PnLMappingResolutieInvoer } from "./pnlBronmapping.js";

function mapping(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4990",
    ogbKostensoort: null,
    economischeModule: "ALGEMENE_KOSTEN",
    economischeCategorie: "ALGEMENE_KOSTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function invoer(overrides: Partial<PnLMappingResolutieInvoer> = {}): PnLMappingResolutieInvoer {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4990",
    ogbKostensoort: null,
    boekjaar: 2025,
    boekperiode: "06",
    opSysteemtijdstip: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("resolveerPnLBronmapping", () => {
  it("A. GL-default zonder OGB", () => {
    const regels = [mapping()];
    const r = resolveerPnLBronmapping(invoer({ ogbKostensoort: null }), regels);
    expect(r).toMatchObject({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" });
  });

  it("B. GL+OGB override binnen dezelfde module", () => {
    const regels = [
      mapping(),
      mapping({ ogbKostensoort: "4992", economischeCategorie: "MAKELAARSKOSTEN" }),
    ];
    const r = resolveerPnLBronmapping(invoer({ ogbKostensoort: "4992" }), regels);
    expect(r).toMatchObject({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "MAKELAARSKOSTEN", specificiteit: "GL_OGB" });
  });

  it("C. onbekende OGB valt terug op GL-default", () => {
    const regels = [mapping(), mapping({ ogbKostensoort: "4992", economischeCategorie: "MAKELAARSKOSTEN" })];
    const r = resolveerPnLBronmapping(invoer({ ogbKostensoort: "9999" }), regels);
    expect(r).toMatchObject({ status: "GEMAPT", economischeCategorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" });
  });

  it("D. onbekende GL -> NIET_GEMAPT", () => {
    const regels = [mapping()];
    const r = resolveerPnLBronmapping(invoer({ grootboekrekening: "9999" }), regels);
    expect(r).toEqual({ status: "NIET_GEMAPT" });
  });

  it("D2. bekende GL zonder enige mapping (geen default, geen OGB-match) -> NIET_GEMAPT", () => {
    const regels: PnLBronmappingRegel[] = [];
    const r = resolveerPnLBronmapping(invoer(), regels);
    expect(r).toEqual({ status: "NIET_GEMAPT" });
  });

  it("E. GL+OGB probeert andere economischeModule dan GL-default -> harde weigering", () => {
    const regels = [
      mapping({ economischeModule: "ALGEMENE_KOSTEN" }),
      mapping({ ogbKostensoort: "4992", economischeModule: "LEEGSTAND", economischeCategorie: "NUTS_LEEGSTAND" }),
    ];
    expect(() => resolveerPnLBronmapping(invoer({ ogbKostensoort: "4992" }), regels)).toThrow(/mag nooit naar een andere economische module springen/);
  });

  it("F. nieuwe mapping vanaf periode: oude periode resolveert oud, nieuwe periode resolveert nieuw", () => {
    const regels = [
      mapping({ economischeCategorie: "OUD", geldigVanafBoekjaar: 2024, geldigVanafPeriode: "01", geldigTotBoekjaar: 2025, geldigTotPeriode: "07", aangemaaktOp: new Date("2024-01-01T00:00:00.000Z") }),
      mapping({ economischeCategorie: "NIEUW", geldigVanafBoekjaar: 2025, geldigVanafPeriode: "07", geldigTotBoekjaar: null, geldigTotPeriode: null, aangemaaktOp: new Date("2025-06-01T00:00:00.000Z") }),
    ];
    const oud = resolveerPnLBronmapping(invoer({ boekjaar: 2025, boekperiode: "06" }), regels);
    const nieuw = resolveerPnLBronmapping(invoer({ boekjaar: 2025, boekperiode: "07" }), regels);
    expect(oud).toMatchObject({ status: "GEMAPT", economischeCategorie: "OUD" });
    expect(nieuw).toMatchObject({ status: "GEMAPT", economischeCategorie: "NIEUW" });
  });

  it("G. historische correctie: live-resolutie van eerdere periode gebruikt na correctie de nieuwe juiste mapping", () => {
    const origineel = mapping({ economischeCategorie: "FOUT", geldigVanafBoekjaar: 2024, geldigVanafPeriode: "01", aangemaaktOp: new Date("2024-01-01T00:00:00.000Z") });
    const correctie = mapping({ economischeCategorie: "CORRECT", geldigVanafBoekjaar: 2024, geldigVanafPeriode: "01", aangemaaktOp: new Date("2026-01-01T00:00:00.000Z") });
    const regels = [origineel, correctie];

    // Vóór de correctie bestond (opSysteemtijdstip vóór de correctie is aangemaakt): alleen het origineel zichtbaar.
    const voorCorrectie = resolveerPnLBronmapping(invoer({ boekjaar: 2024, boekperiode: "03", opSysteemtijdstip: new Date("2025-01-01T00:00:00.000Z") }), regels);
    expect(voorCorrectie).toMatchObject({ economischeCategorie: "FOUT" });

    // Ná de correctie: dezelfde historische periode resolveert nu de correcte mapping.
    const naCorrectie = resolveerPnLBronmapping(invoer({ boekjaar: 2024, boekperiode: "03", opSysteemtijdstip: new Date("2026-06-01T00:00:00.000Z") }), regels);
    expect(naCorrectie).toMatchObject({ economischeCategorie: "CORRECT" });
  });

  it("H. twee opeenvolgende historische correcties: resolver blijft eenduidig en gebruikt de laatst geldige kennis", () => {
    const v1 = mapping({ economischeCategorie: "V1", geldigVanafBoekjaar: 2024, geldigVanafPeriode: "01", aangemaaktOp: new Date("2024-01-01T00:00:00.000Z") });
    const v2 = mapping({ economischeCategorie: "V2", geldigVanafBoekjaar: 2024, geldigVanafPeriode: "01", aangemaaktOp: new Date("2025-01-01T00:00:00.000Z") });
    const v3 = mapping({ economischeCategorie: "V3", geldigVanafBoekjaar: 2024, geldigVanafPeriode: "01", aangemaaktOp: new Date("2026-01-01T00:00:00.000Z") });
    const regels = [v1, v2, v3];

    const opT0 = resolveerPnLBronmapping(invoer({ boekjaar: 2024, boekperiode: "03", opSysteemtijdstip: new Date("2024-06-01T00:00:00.000Z") }), regels);
    const opT1 = resolveerPnLBronmapping(invoer({ boekjaar: 2024, boekperiode: "03", opSysteemtijdstip: new Date("2025-06-01T00:00:00.000Z") }), regels);
    const opT2 = resolveerPnLBronmapping(invoer({ boekjaar: 2024, boekperiode: "03", opSysteemtijdstip: new Date("2026-06-01T00:00:00.000Z") }), regels);

    expect(opT0).toMatchObject({ economischeCategorie: "V1" });
    expect(opT1).toMatchObject({ economischeCategorie: "V2" });
    expect(opT2).toMatchObject({ economischeCategorie: "V3" });
  });

  it("I. exacte aangemaaktOp-tie tussen twee overlappende regels faalt fail-fast (geen stille/willekeurige keuze)", () => {
    const gelijktijdig = new Date("2026-01-01T00:00:00.000Z");
    const regels = [
      mapping({ economischeCategorie: "A", aangemaaktOp: gelijktijdig }),
      mapping({ economischeCategorie: "B", aangemaaktOp: gelijktijdig }),
    ];
    expect(() => resolveerPnLBronmapping(invoer(), regels)).toThrow(/ambigu, kan niet eenduidig worden opgelost/);
  });

  it("J1. boeking zonder OGB matcht nooit een GL+OGB-specifieke regel", () => {
    const regels = [mapping({ economischeCategorie: "DEFAULT" }), mapping({ ogbKostensoort: "4992", economischeCategorie: "MAKELAARSKOSTEN" })];
    const r = resolveerPnLBronmapping(invoer({ ogbKostensoort: null }), regels);
    expect(r).toMatchObject({ specificiteit: "GL_DEFAULT", economischeCategorie: "DEFAULT" });
  });

  it("J2. boeking mét OGB gebruikt de GL+OGB-regel wanneer die bestaat, ondanks een aanwezige GL-default", () => {
    const regels = [mapping({ economischeCategorie: "DEFAULT" }), mapping({ ogbKostensoort: "4992", economischeCategorie: "MAKELAARSKOSTEN" })];
    const r = resolveerPnLBronmapping(invoer({ ogbKostensoort: "4992" }), regels);
    expect(r).toMatchObject({ specificiteit: "GL_OGB", economischeCategorie: "MAKELAARSKOSTEN" });
  });

  it("buiten geldigheidsperiode (vóór geldigVanaf) -> NIET_GEMAPT", () => {
    const regels = [mapping({ geldigVanafBoekjaar: 2025, geldigVanafPeriode: "01" })];
    const r = resolveerPnLBronmapping(invoer({ boekjaar: 2024, boekperiode: "12" }), regels);
    expect(r).toEqual({ status: "NIET_GEMAPT" });
  });

  it("mappingregel met aangemaaktOp ná het gevraagde opSysteemtijdstip telt niet mee (systeemtijd-cutoff werkt)", () => {
    const regels = [mapping({ aangemaaktOp: new Date("2026-12-01T00:00:00.000Z") })];
    const r = resolveerPnLBronmapping(invoer({ opSysteemtijdstip: new Date("2026-01-01T00:00:00.000Z") }), regels);
    expect(r).toEqual({ status: "NIET_GEMAPT" });
  });
});

describe("070 / GL4990 — bewezen bronproef als regressiefixture (OB-039-sessie, boekjaar 2025)", () => {
  const BEDRIJFSNR = "070";
  const GL = "4990";
  const AANGEMAAKT = new Date("2026-09-14T00:00:00.000Z");

  const regels: PnLBronmappingRegel[] = [
    {
      bedrijfsnr: BEDRIJFSNR,
      grootboekrekening: GL,
      ogbKostensoort: null,
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "ALGEMENE_KOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
    {
      bedrijfsnr: BEDRIJFSNR,
      grootboekrekening: GL,
      ogbKostensoort: "4992",
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "MAKELAARSKOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
    {
      bedrijfsnr: BEDRIJFSNR,
      grootboekrekening: GL,
      ogbKostensoort: "4995",
      economischeModule: "ALGEMENE_KOSTEN",
      economischeCategorie: "BANKKOSTEN",
      geldigVanafBoekjaar: 2025,
      geldigVanafPeriode: "01",
      geldigTotBoekjaar: null,
      geldigTotPeriode: null,
      aangemaaktOp: AANGEMAAKT,
    },
  ];

  function query(overrides: Partial<PnLMappingResolutieInvoer> = {}) {
    return resolveerPnLBronmapping(
      invoer({ bedrijfsnr: BEDRIJFSNR, grootboekrekening: GL, boekjaar: 2025, boekperiode: "06", opSysteemtijdstip: new Date("2026-09-14T12:00:00.000Z"), ...overrides }),
      regels,
    );
  }

  it("4990/4992 -> ALGEMENE_KOSTEN / MAKELAARSKOSTEN (bewezen: 'bma bemiddeling verhuur' bij Bernheze makelaars & adviseurs)", () => {
    expect(query({ ogbKostensoort: "4992" })).toMatchObject({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "MAKELAARSKOSTEN", specificiteit: "GL_OGB" });
  });

  it("4990/4995 -> ALGEMENE_KOSTEN / BANKKOSTEN", () => {
    expect(query({ ogbKostensoort: "4995" })).toMatchObject({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "BANKKOSTEN", specificiteit: "GL_OGB" });
  });

  it("onbekende/niet-afgesplitste OGB binnen 4990 (bv. 4991 Afronding/betalingsversch) -> GL-default", () => {
    expect(query({ ogbKostensoort: "4991" })).toMatchObject({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" });
  });

  it("geen OGB binnen 4990 -> GL-default", () => {
    expect(query({ ogbKostensoort: null })).toMatchObject({ status: "GEMAPT", economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN", specificiteit: "GL_DEFAULT" });
  });
});
