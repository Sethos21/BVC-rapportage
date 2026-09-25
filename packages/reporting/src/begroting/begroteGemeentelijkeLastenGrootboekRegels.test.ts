import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  bepaalRelevanteGemeentelijkeLastenGrootboeken,
  berekenBegroteGemeentelijkeLastenPerGrootboek,
  type BgGlLastenRegelInvoer,
  type BgRelevantGrootboek,
} from "./begroteGemeentelijkeLastenGrootboekRegels.js";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";

/**
 * Directe begroting per relevante GL (Master Contract §6.8, besluit 2026-09-25). Testfixtures zijn expliciet
 * gemarkeerde mappingvoorbeelden: de GL-sets volgen de bronbewezen situatie (070: GL4700+OGB4701 en GL4710;
 * andere administraties: één GL4701), maar de calculator kent geen enkele GL — alles komt uit de mapping.
 */

const T0 = new Date("2026-09-15T00:00:00.000Z");

function mapping(overrides: Partial<PnLBronmappingRegel> = {}): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4700",
    ogbKostensoort: "4701",
    economischeModule: "GEMEENTELIJKE_LASTEN",
    economischeCategorie: "GEMEENTELIJKE_LASTEN",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: T0,
    ...overrides,
  };
}

const MAPPING_070: PnLBronmappingRegel[] = [
  mapping({ grootboekrekening: "4700", ogbKostensoort: "4701" }),
  mapping({ grootboekrekening: "4710", ogbKostensoort: null }),
  // Ander hoofddomein: nooit relevant voor Gemeentelijke lasten.
  mapping({ grootboekrekening: "4130", ogbKostensoort: "4131", economischeModule: "VERZEKERINGEN", economischeCategorie: "BRAND_OPSTALVERZEKERING" }),
];

const RELEVANT_070: BgRelevantGrootboek[] = [
  { grootboekrekening: "4700", glDefault: false, ogbKostensoorten: ["4701"] },
  { grootboekrekening: "4710", glDefault: true, ogbKostensoorten: [] },
];
const RELEVANT_003: BgRelevantGrootboek[] = [{ grootboekrekening: "4701", glDefault: true, ogbKostensoorten: [] }];

function regel(overrides: Partial<BgGlLastenRegelInvoer> = {}): BgGlLastenRegelInvoer {
  return { grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: new Decimal(1000), ...overrides };
}

const kritiek = (r: ReturnType<typeof berekenBegroteGemeentelijkeLastenPerGrootboek>) => r.controleVereist.filter((c) => c.ernst === "KRITIEK");
const waarschuwingen = (r: ReturnType<typeof berekenBegroteGemeentelijkeLastenPerGrootboek>) => r.controleVereist.filter((c) => c.ernst === "WAARSCHUWING");

describe("bepaalRelevanteGemeentelijkeLastenGrootboeken — gegevensgedreven per administratie", () => {
  it("070: GL4700 (alleen via OGB4701, geen GL-default) en GL4710 (GL-default); een andere module (GL4130) is niet relevant", () => {
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken(MAPPING_070, { bedrijfsnr: "070", begrotingsjaar: 2027 })).toEqual(RELEVANT_070);
  });

  it("een administratie met één GL4701 (GL-default) krijgt precies die ene GL — geen 070-GL's", () => {
    const mapping003 = [mapping({ bedrijfsnr: "003", grootboekrekening: "4701", ogbKostensoort: null })];
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken([...MAPPING_070, ...mapping003], { bedrijfsnr: "003", begrotingsjaar: 2027 })).toEqual(RELEVANT_003);
  });

  it("administratie zonder mappingregels: lege set (geen gok, geen 070-fallback)", () => {
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken(MAPPING_070, { bedrijfsnr: "999", begrotingsjaar: 2027 })).toEqual([]);
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken([], { bedrijfsnr: "070", begrotingsjaar: 2027 })).toEqual([]);
  });

  it("een GL wiens mapping vóór het begrotingsjaar is geëindigd is niet relevant; een mapping die halverwege het jaar eindigt wel", () => {
    const beeindigd = [mapping({ grootboekrekening: "4710", ogbKostensoort: null, geldigTotBoekjaar: 2027, geldigTotPeriode: "01" })];
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken(beeindigd, { bedrijfsnr: "070", begrotingsjaar: 2027 })).toEqual([]);
    const halverwege = [mapping({ grootboekrekening: "4710", ogbKostensoort: null, geldigTotBoekjaar: 2027, geldigTotPeriode: "07" })];
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken(halverwege, { bedrijfsnr: "070", begrotingsjaar: 2027 })).toHaveLength(1);
  });

  it("een mapping die pas na het begrotingsjaar ingaat is niet relevant", () => {
    const later = [mapping({ grootboekrekening: "4710", ogbKostensoort: null, geldigVanafBoekjaar: 2028, geldigVanafPeriode: "01" })];
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken(later, { bedrijfsnr: "070", begrotingsjaar: 2027 })).toEqual([]);
  });

  it("een historische correctie naar een ander hoofddomein wint (nieuwste aangemaaktOp): de GL is dan niet meer relevant", () => {
    const gecorrigeerd = [
      mapping({ grootboekrekening: "4710", ogbKostensoort: null }),
      mapping({ grootboekrekening: "4710", ogbKostensoort: null, economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "OVERIG", aangemaaktOp: new Date("2026-09-20T00:00:00.000Z") }),
    ];
    expect(bepaalRelevanteGemeentelijkeLastenGrootboeken(gecorrigeerd, { bedrijfsnr: "070", begrotingsjaar: 2027 })).toEqual([]);
  });
});

describe("berekenBegroteGemeentelijkeLastenPerGrootboek — post = som van de GL-regels", () => {
  it("bij één relevante GL bestaat de post uit één regel", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4701", jaarbedrag: new Decimal("12345.67") })], RELEVANT_003);
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("12345.67");
    expect(r.perGrootboek).toEqual([{ grootboekrekening: "4701", aantalRegels: 1, subtotaal: new Decimal("12345.67") }]);
    expect(r.controleVereist).toEqual([]);
  });

  it("bij meerdere relevante GL's worden de regels afzonderlijk begroot en opgeteld tot ÉÉN post; subtotalen per GL blijven zichtbaar", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek(
      [regel({ grootboekrekening: "4700", ogbKostensoort: "4701", jaarbedrag: new Decimal("8000.10") }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal("2000.20") })],
      RELEVANT_070,
    );
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("10000.3");
    expect(r.perGrootboek.map((g) => [g.grootboekrekening, g.subtotaal.toString()])).toEqual([
      ["4700", "8000.1"],
      ["4710", "2000.2"],
    ]);
    expect(kritiek(r)).toEqual([]);
  });

  it("er wordt NIETS verdeeld: elke regel draagt exact haar eigen ingevoerde bedrag bij (geen verdeelsleutel, geen percentage)", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek(
      [regel({ grootboekrekening: "4700", jaarbedrag: new Decimal(100) }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(300) })],
      RELEVANT_070,
    );
    expect(r.regels.map((x) => x.bijdrage.toString())).toEqual(["100", "300"]);
  });

  it("GL is leidend, OGB optioneel: GL4700 zonder OGB is geldig (OGB alleen verfijning) — geen melding", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4700", ogbKostensoort: null }), regel({ grootboekrekening: "4710" })], RELEVANT_070);
    expect(kritiek(r)).toEqual([]);
  });

  it("OGB als verfijning binnen dezelfde GL: bekende OGB onder GL4700 en willekeurige OGB onder GL-default GL4710 zijn geldig", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek(
      [regel({ grootboekrekening: "4700", ogbKostensoort: "4701" }), regel({ grootboekrekening: "4710", ogbKostensoort: "4710" })],
      RELEVANT_070,
    );
    expect(kritiek(r)).toEqual([]);
  });

  it("een OGB die binnen de GL niet in de mapping staat (GL zonder GL-default) is KRITIEK — een OGB creëert nooit iets nieuws", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4700", ogbKostensoort: "9999" })], RELEVANT_070);
    expect(kritiek(r)).toHaveLength(1);
    expect(kritiek(r)[0]!.bericht).toContain("9999");
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("1000"); // bijdrage verdwijnt niet stil
  });

  it("een lege OGB-string is KRITIEK (niet stil naar null)", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ ogbKostensoort: "  " })], RELEVANT_070);
    expect(kritiek(r)).toHaveLength(1);
  });

  it("een GL die voor de administratie niet relevant is (bv. een 070-GL bij administratie 003) is KRITIEK — geen hardcoded 070-waarheid", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4710" })], RELEVANT_003);
    expect(kritiek(r)).toHaveLength(1);
    expect(kritiek(r)[0]!.bericht).toContain("4710");
  });

  it("zonder enige relevante GL (administratie zonder mapping) is elke regel KRITIEK — nooit een gok", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4701" })], []);
    expect(kritiek(r)).toHaveLength(1);
  });

  it("ontbrekende of lege grootboekrekening is KRITIEK; het bedrag telt wel mee in de post maar niet in perGrootboek", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: null }), regel({ grootboekrekening: "  " })], RELEVANT_070);
    expect(kritiek(r)).toHaveLength(2);
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("2000");
    expect(r.perGrootboek).toEqual([]);
  });

  it("jaarbedrag null (niet ingevuld) is KRITIEK en draagt veilig 0 bij — nooit stil €0", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ jaarbedrag: null })], RELEVANT_070);
    expect(kritiek(r)).toHaveLength(1);
    expect(r.regels[0]!.invoer.jaarbedrag).toBeNull();
    expect(r.regels[0]!.bijdrage.toString()).toBe("0");
  });

  it("bewust €0 is geldig: geen enkele melding op die regel", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ jaarbedrag: new Decimal(0) })], [{ grootboekrekening: "4710", glDefault: true, ogbKostensoorten: [] }]);
    expect(r.controleVereist).toEqual([]);
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("0");
  });

  it("NaN-bedrag is KRITIEK met veilige bijdrage 0", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ jaarbedrag: new Decimal(NaN) })], RELEVANT_070);
    expect(kritiek(r)).toHaveLength(1);
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("0");
  });

  it("negatief jaarbedrag is geldig met WAARSCHUWING (geen Math.abs: het teken blijft, de som verrekent het)", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4700", jaarbedrag: new Decimal(500) }), regel({ jaarbedrag: new Decimal(-200) })], RELEVANT_070);
    expect(kritiek(r)).toEqual([]);
    expect(waarschuwingen(r).some((w) => w.regelIndex === 1 && w.bericht.includes("negatief"))).toBe(true);
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("300");
  });

  it("dubbele (GL, OGB)-regel is KRITIEK; dezelfde GL met verschillende OGB's of één zonder OGB is géén duplicaat", () => {
    const dubbel = berekenBegroteGemeentelijkeLastenPerGrootboek([regel(), regel()], RELEVANT_070);
    expect(kritiek(dubbel)).toHaveLength(1);
    expect(kritiek(dubbel)[0]!.regelIndex).toBe(1);
    const verschillend = berekenBegroteGemeentelijkeLastenPerGrootboek(
      [regel({ grootboekrekening: "4710", ogbKostensoort: null }), regel({ grootboekrekening: "4710", ogbKostensoort: "A" }), regel({ grootboekrekening: "4710", ogbKostensoort: "B" })],
      RELEVANT_070,
    );
    expect(kritiek(verschillend)).toEqual([]);
  });

  it("dezelfde GL zowel zonder als met OGB: niet-blokkerende WAARSCHUWING over mogelijke overlap; bedragen worden opgeteld", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek(
      [regel({ grootboekrekening: "4710", ogbKostensoort: null, jaarbedrag: new Decimal(100) }), regel({ grootboekrekening: "4710", ogbKostensoort: "X", jaarbedrag: new Decimal(50) })],
      RELEVANT_070,
    );
    expect(kritiek(r)).toEqual([]);
    expect(waarschuwingen(r).some((w) => w.regelIndex === null && w.bericht.includes("overlappen"))).toBe(true);
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("150");
  });

  it("een relevante GL zonder regel geeft een niet-blokkerende WAARSCHUWING (telt als €0 in de post); geen enkele regel = post 0", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4710" })], RELEVANT_070);
    expect(kritiek(r)).toEqual([]);
    expect(waarschuwingen(r).filter((w) => w.bericht.includes("4700"))).toHaveLength(1);
    const leeg = berekenBegroteGemeentelijkeLastenPerGrootboek([], RELEVANT_070);
    expect(leeg.begroteGemeentelijkeLastenPost.toString()).toBe("0");
    expect(kritiek(leeg)).toEqual([]);
    expect(leeg.regels).toEqual([]);
  });

  it("Decimal-exactheid: de som van bedragen met decimalen is exact (geen floating point)", () => {
    const r = berekenBegroteGemeentelijkeLastenPerGrootboek(
      [regel({ grootboekrekening: "4700", jaarbedrag: new Decimal("0.1") }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal("0.2") })],
      RELEVANT_070,
    );
    expect(r.begroteGemeentelijkeLastenPost.toString()).toBe("0.3");
  });

  it("rekent onafhankelijk van historische verhoudingen: identieke regels geven identiek resultaat ongeacht de realisatieverhouding (geen verdeelsleutel in de invoer)", () => {
    const a = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4700", jaarbedrag: new Decimal(10) }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(90) })], RELEVANT_070);
    const b = berekenBegroteGemeentelijkeLastenPerGrootboek([regel({ grootboekrekening: "4700", jaarbedrag: new Decimal(90) }), regel({ grootboekrekening: "4710", jaarbedrag: new Decimal(10) })], RELEVANT_070);
    expect(a.begroteGemeentelijkeLastenPost.toString()).toBe(b.begroteGemeentelijkeLastenPost.toString());
    expect(a.perGrootboek[0]!.subtotaal.toString()).toBe("10");
    expect(b.perGrootboek[0]!.subtotaal.toString()).toBe("90");
  });
});
