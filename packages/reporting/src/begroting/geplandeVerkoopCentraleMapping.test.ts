import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenWerkelijkGeplandeVerkoop,
  type GeplandeVerkoopClassificatieRegel,
  type GeplandeVerkoopGrootboekClassificatieRegel,
  type WerkelijkGeplandeVerkoopBoekingRegel,
} from "./begroteGeplandeVerkoop.js";
import {
  berekenWerkelijkGeplandeVerkoopViaCentraleMapping,
  resolveerGeplandeVerkoopComponentViaCentraleMapping,
  type GeplandeVerkoopCentraleMappingInvoer,
  type GeplandeVerkoopRuweBoekingRegel,
  type GeplandeVerkoopWerkelijkViaCentraleMappingInvoer,
} from "./geplandeVerkoopCentraleMapping.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * FASE M6a — migreert Geplande Verkoop (OB-039) naar de centrale
 * P&L-bronmappingresolver, NA het expliciete businessbesluit dat de OGB-
 * classificatie GL-gescoped moet zijn (zie moduledoc `geplandeVerkoopCentraleMapping.ts`
 * en `begroteGeplandeVerkoop.test.ts`'s bijgewerkte "V (LEGACY)"-test).
 *
 * Bewezen 023-bronmapping (023_Malcon_Beheer_BV, boekjaar 2026 periode 04):
 *  - GL00166 + OGB "3010" -> BOEKWAARDE_AFBOEKING (GL+OGB-specifiek).
 *  - GL08830 (GL-default, GEEN specifieke OGB-mapping) -> VERKOOPOPBRENGST.
 *  - GL00167 -> GEEN mapping (nooit bewezen) -> blijft NIET_GEMAPT.
 */

const AANGEMAAKT = new Date("2026-09-15T00:00:00.000Z");

/** OUDE, bewezen classificatie (commit cfd53dd) — exact zoals `begroteGeplandeVerkoop.test.ts`. */
const OGB_KLASSIFICATIE_023: GeplandeVerkoopClassificatieRegel[] = [
  { ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", component: "BOEKWAARDE_AFBOEKING" },
];
const GL_KLASSIFICATIE_023: GeplandeVerkoopGrootboekClassificatieRegel[] = [
  { grootboekrekening: "08830", grootboekOmschrijving: "Opbrengst verkoop pand", component: "VERKOOPOPBRENGST" },
];

function mappingRegel(overrides: Partial<PnLBronmappingRegel>): PnLBronmappingRegel {
  return {
    bedrijfsnr: "023",
    grootboekrekening: "08830",
    ogbKostensoort: null,
    economischeModule: "VERKOOP",
    economischeCategorie: "VERKOOPOPBRENGST",
    geldigVanafBoekjaar: 2026,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

/** NIEUWE centrale mapping voor 023 — GEEN fictieve rij voor GL00167 (nooit bewezen, zie M6a-opdracht §6). */
const MAPPING_023: PnLBronmappingRegel[] = [
  mappingRegel({ grootboekrekening: "08830", ogbKostensoort: null, economischeCategorie: "VERKOOPOPBRENGST" }),
  mappingRegel({ grootboekrekening: "00166", ogbKostensoort: "3010", economischeCategorie: "BOEKWAARDE_AFBOEKING" }),
];

function invoer(overrides: Partial<GeplandeVerkoopCentraleMappingInvoer> = {}): GeplandeVerkoopCentraleMappingInvoer {
  return { bedrijfsnr: "023", grootboekrekening: "08830", boekjaar: 2026, boekperiode: "04", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
}

function normaliseer(waarde: unknown): string {
  return JSON.stringify(waarde, (_key, v) => (v instanceof Decimal ? v.toString() : v));
}

describe("resolveerGeplandeVerkoopComponentViaCentraleMapping — 023-bronmapping", () => {
  it("A/E. GL00166 + OGB 3010 (GL+OGB-specifiek) resolveert naar BOEKWAARDE_AFBOEKING", () => {
    expect(resolveerGeplandeVerkoopComponentViaCentraleMapping(invoer({ grootboekrekening: "00166" }), "3010", MAPPING_023)).toEqual({
      categorie: "BOEKWAARDE_AFBOEKING",
      specificiteit: "GL_OGB",
    });
  });

  it("A. GL08830 zonder OGB resolveert naar VERKOOPOPBRENGST via GL-default", () => {
    expect(resolveerGeplandeVerkoopComponentViaCentraleMapping(invoer({ grootboekrekening: "08830" }), null, MAPPING_023)).toEqual({
      categorie: "VERKOOPOPBRENGST",
      specificiteit: "GL_DEFAULT",
    });
  });

  it("D. NIEUWE BUSINESSREGEL — GL08830 + OGB 3010 (GEEN specifieke (08830,3010)-mapping) valt terug op GL08830's eigen GL-default (VERKOOPOPBRENGST), NIET op OGB 3010's betekenis van GL00166", () => {
    const resultaat = resolveerGeplandeVerkoopComponentViaCentraleMapping(invoer({ grootboekrekening: "08830" }), "3010", MAPPING_023);
    expect(resultaat).toEqual({ categorie: "VERKOOPOPBRENGST", specificiteit: "GL_DEFAULT" });
    // Expliciet: dit is NIET meer BOEKWAARDE_AFBOEKING (de oude, bewust vervallen administratiebrede
    // OGB-precedentie — zie begroteGeplandeVerkoop.test.ts's "V (LEGACY)"-test).
    expect(resultaat?.categorie).not.toBe("BOEKWAARDE_AFBOEKING");
  });

  it("F. GL00167 (nooit bewezen, geen mapping) -> NIET_GEMAPT", () => {
    expect(resolveerGeplandeVerkoopComponentViaCentraleMapping(invoer({ grootboekrekening: "00167" }), null, MAPPING_023)).toBeNull();
  });

  it("module-invariant blijft hard: een (per ongeluk) toegevoegde mapping met een andere module dan VERKOOP faalt fail-fast", () => {
    const kapotteMapping: PnLBronmappingRegel[] = [...MAPPING_023, mappingRegel({ grootboekrekening: "08830", ogbKostensoort: "9999", economischeModule: "RENTE", economischeCategorie: "RENTEKOSTEN" })];
    expect(() => resolveerGeplandeVerkoopComponentViaCentraleMapping(invoer({ grootboekrekening: "08830" }), "9999", kapotteMapping)).toThrow(/mag nooit naar een andere economische module springen/);
  });
});

describe("berekenWerkelijkGeplandeVerkoop — oud vs. nieuw, byte-identiek op de echte 023-bronproef", () => {
  it("C. de echte 023-bronproef (Hoofdstraat + Driebergen, 4 boekingen) blijft economisch identiek onder de centrale, GL-geneste resolutie", () => {
    const boekingen: WerkelijkGeplandeVerkoopBoekingRegel[] = [
      { grootboekrekening: "08830", ogbKostensoort: null, saldo: new Decimal(-785000) }, // Hoofdstraat-opbrengst
      { grootboekrekening: "00166", ogbKostensoort: "3010", saldo: new Decimal(-535000) }, // Driebergen-boekwaarde ASW
      { grootboekrekening: "00167", ogbKostensoort: null, saldo: new Decimal(-100000) }, // Driebergen-boekwaarde HW, geen classificatiebron
      { grootboekrekening: "08830", ogbKostensoort: null, saldo: new Decimal(635000) }, // Driebergen-reclassificatie op 08830
    ];

    const resultaatOud = berekenWerkelijkGeplandeVerkoop(boekingen, OGB_KLASSIFICATIE_023, GL_KLASSIFICATIE_023);

    // Nieuw: classificatie-arrays VERS afgeleid uit de centrale mapping voor exact deze boekingen (zie
    // geplandeVerkoopCentraleMapping.ts's moduledoc voor de GL_OGB/GL_DEFAULT-routering).
    const ruweBoekingen: GeplandeVerkoopRuweBoekingRegel[] = boekingen.map((b) => ({
      grootboekrekening: b.grootboekrekening,
      grootboekOmschrijving: b.grootboekrekening === "08830" ? "Opbrengst verkoop pand" : null,
      ogbKostensoort: b.ogbKostensoort,
      ogbKostensoortOmschrijving: b.ogbKostensoort === "3010" ? "afwaardering ASW" : null,
      saldo: b.saldo,
    }));
    const { werkelijk: resultaatNieuw, nietGemapt } = berekenWerkelijkGeplandeVerkoopViaCentraleMapping(
      { bedrijfsnr: "023", boekjaar: 2026, boekperiode: "04", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z") },
      ruweBoekingen,
      MAPPING_023,
    );

    expect(normaliseer(resultaatNieuw)).toBe(normaliseer(resultaatOud));
    expect(resultaatOud.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.componentTotaal.toString()).toBe("-150000");
    expect(resultaatOud.perComponent.find((c) => c.component === "BOEKWAARDE_AFBOEKING")!.componentTotaal.toString()).toBe("-535000");
    expect(resultaatOud.nietGeclassificeerdTotaal.toString()).toBe("-100000");
    expect(nietGemapt).toEqual([{ grootboekrekening: "00167", ogbKostensoort: null }]);
  });
});

describe("berekenWerkelijkGeplandeVerkoopViaCentraleMapping — FASE M6a: de daadwerkelijk gewirede productieketen", () => {
  function ruweBoeking(overrides: Partial<GeplandeVerkoopRuweBoekingRegel> = {}): GeplandeVerkoopRuweBoekingRegel {
    return { grootboekrekening: "08830", grootboekOmschrijving: "Opbrengst verkoop pand", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal(0), ...overrides };
  }
  function keteninvoer(overrides: Partial<GeplandeVerkoopWerkelijkViaCentraleMappingInvoer> = {}): GeplandeVerkoopWerkelijkViaCentraleMappingInvoer {
    return { bedrijfsnr: "023", boekjaar: 2026, boekperiode: "04", opSysteemtijdstip: new Date("2026-09-15T12:00:00.000Z"), ...overrides };
  }

  it("D (geïsoleerd, productieketen). GL08830 + OGB 3010 zonder specifieke mapping -> GL08830-default (VERKOOPOPBRENGST), NOOIT BOEKWAARDE_AFBOEKING", () => {
    // Bewust GEEN GL00166/OGB3010-boeking in dezelfde batch: die combinatie komt in de echte 023-bronproef
    // nooit samen voor (zie test C) — zouden ze wél samen voorkomen, dan hoort de batch-brede
    // consistentiecheck van classificeerBoekingenViaPnLMapping fail-fast te gaan (zie dat bestand se test).
    const boekingen = [ruweBoeking({ grootboekrekening: "08830", ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", saldo: new Decimal(-1000) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkGeplandeVerkoopViaCentraleMapping(keteninvoer(), boekingen, MAPPING_023);

    expect(nietGemapt).toEqual([]);
    expect(werkelijk.perComponent.find((c) => c.component === "VERKOOPOPBRENGST")!.componentTotaal.toString()).toBe("-1000");
    expect(werkelijk.perComponent.find((c) => c.component === "BOEKWAARDE_AFBOEKING")!.componentTotaal.toString()).toBe("0");
  });

  it("de exacte legacy-botsing (GL00166/OGB3010 EN GL08830/OGB3010 in dezelfde batch) faalt fail-fast in plaats van stil fout te classificeren", () => {
    const boekingen = [
      ruweBoeking({ grootboekrekening: "00166", grootboekOmschrijving: null, ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", saldo: new Decimal(-535000) }),
      ruweBoeking({ grootboekrekening: "08830", ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", saldo: new Decimal(-1000) }),
    ];
    expect(() => berekenWerkelijkGeplandeVerkoopViaCentraleMapping(keteninvoer(), boekingen, MAPPING_023)).toThrow(/resolveert binnen deze batch verschillend afhankelijk van de grootboekrekening/);
  });

  it("G. geen automatisch gecombineerd verkoopresultaat — VERKOOPOPBRENGST en BOEKWAARDE_AFBOEKING blijven altijd apart, ook via de centrale keten", () => {
    const { werkelijk } = berekenWerkelijkGeplandeVerkoopViaCentraleMapping(keteninvoer(), [ruweBoeking()], MAPPING_023);
    expect((werkelijk as unknown as { verkoopresultaat?: unknown }).verkoopresultaat).toBeUndefined();
    expect((werkelijk as unknown as { totaal?: unknown }).totaal).toBeUndefined();
  });

  it("onbekende OGB-code op GL00166 zonder default -> expliciet NIET_GEMAPT (GL00166 heeft zelf geen GL-default)", () => {
    const boekingen = [ruweBoeking({ grootboekrekening: "00166", grootboekOmschrijving: null, ogbKostensoort: "9999", ogbKostensoortOmschrijving: "onbekend", saldo: new Decimal(500) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkGeplandeVerkoopViaCentraleMapping(keteninvoer(), boekingen, MAPPING_023);
    expect(nietGemapt).toEqual([{ grootboekrekening: "00166", ogbKostensoort: "9999" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("500");
  });

  it("GL wordt nooit uit OGB afgeleid: OGB 3010 op een fictieve, niet-gemapte GL resolveert onafhankelijk (blijft NIET_GEMAPT)", () => {
    const boekingen = [ruweBoeking({ grootboekrekening: "77777", grootboekOmschrijving: null, ogbKostensoort: "3010", ogbKostensoortOmschrijving: "afwaardering ASW", saldo: new Decimal(777) })];
    const { werkelijk, nietGemapt } = berekenWerkelijkGeplandeVerkoopViaCentraleMapping(keteninvoer(), boekingen, MAPPING_023);
    expect(nietGemapt).toEqual([{ grootboekrekening: "77777", ogbKostensoort: "3010" }]);
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("777");
  });
});
