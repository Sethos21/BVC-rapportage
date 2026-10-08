import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bepaalWozHistorie, type BgWozObjectInvoer } from "./begroteGemeentelijkeLasten.js";
import { WOZ_HISTORIE_CSV_KOLOMMEN, bouwWozHistorieCsv } from "./wozHistorieCsv.js";

function woz(overrides: Partial<BgWozObjectInvoer> = {}): BgWozObjectInvoer {
  return {
    complexnummer: "001",
    objectType: "GEHEEL_COMPLEX",
    unitnummer: null,
    aanslagjaar: 2026,
    waardepeildatum: new Date(Date.UTC(2025, 0, 1)),
    werkelijkeWoz: new Decimal(1000000),
    verwachteWozOverride: null,
    ...overrides,
  };
}

const OBJECTEN = [
  woz({ aanslagjaar: 2025, waardepeildatum: new Date(Date.UTC(2024, 0, 1)), werkelijkeWoz: new Decimal(1000000) }),
  woz({ aanslagjaar: 2026, waardepeildatum: new Date(Date.UTC(2025, 0, 1)), werkelijkeWoz: new Decimal(1050000) }),
  woz({ complexnummer: "002", objectType: "UNIT", unitnummer: "A-12", aanslagjaar: 2026, werkelijkeWoz: new Decimal(190000.5) }),
];

function bouw(overrides: Partial<Parameters<typeof bouwWozHistorieCsv>[0]> = {}) {
  const r = bouwWozHistorieCsv({ administratie: "070", wozObjecten: OBJECTEN, wozSetBevestigd: true, ...overrides });
  if (!r.beschikbaar) throw new Error("export niet beschikbaar");
  return r;
}

describe("bouwWozHistorieCsv", () => {
  it("bevat exact de vastgestelde kolommen in vaste volgorde als header", () => {
    expect(WOZ_HISTORIE_CSV_KOLOMMEN).toEqual([
      "Administratie",
      "Complex",
      "Unit/Geheel complex",
      "Aanslagjaar",
      "Waardepeildatum",
      "Werkelijke WOZ",
      "Verschil € vorig jaar",
      "Verschil % vorig jaar",
    ]);
    expect(bouw().csv.split("\r\n")[0]).toBe(WOZ_HISTORIE_CSV_KOLOMMEN.join(";"));
  });

  it("rijen: administratie, complex, geheel complex/unit, jaar, ISO-datum, exacte WOZ en ontwikkeling; eerste jaar heeft lege verschil-cellen (geen 0)", () => {
    const regels = bouw().csv.split("\r\n");
    expect(regels[1]).toBe("070;001;Geheel complex;2025;2024-01-01;1000000;;");
    expect(regels[2]).toBe("070;001;Geheel complex;2026;2025-01-01;1050000;50000;5,00");
    expect(regels[3]).toBe("070;002;A-12;2026;2025-01-01;190000,5;;");
    expect(regels[4]).toBe(""); // sluit af met CRLF
  });

  it("filter op complex en periode; ontwikkeling van het eerste gefilterde jaar blijft t.o.v. het jaar vóór het filter", () => {
    const r = bouw({ filter: { complexnummer: "001", aanslagjaarVan: 2026, aanslagjaarTot: 2026 } });
    expect(r.aantalRegels).toBe(1);
    expect(r.csv.split("\r\n")[1]).toBe("070;001;Geheel complex;2026;2025-01-01;1050000;50000;5,00");
  });

  it("niet-bevestigde WOZ-set: export niet beschikbaar (uitgeschakeld), geen CSV", () => {
    expect(bouwWozHistorieCsv({ administratie: "070", wozObjecten: OBJECTEN, wozSetBevestigd: false })).toEqual({ beschikbaar: false, reden: "WOZ_SET_NIET_BEVESTIGD" });
  });

  it("bevestigd maar niets binnen het filter: alleen de header, geen fout", () => {
    const r = bouw({ filter: { complexnummer: "999" } });
    expect(r.aantalRegels).toBe(0);
    expect(r.csv).toBe(WOZ_HISTORIE_CSV_KOLOMMEN.join(";") + "\r\n");
  });

  it("velden met scheidingsteken/aanhalingsteken worden RFC-4180-gequote; formule-voorvoegsels in tekstcellen worden geneutraliseerd", () => {
    const r = bouw({ administratie: "07;0", wozObjecten: [woz({ complexnummer: '=HYPERLINK("x")', objectType: "UNIT", unitnummer: "+1" })] });
    expect(r.csv.split("\r\n")[1]).toBe(`"07;0";"'=HYPERLINK(""x"")";'+1;2026;2025-01-01;1000000;;`);
  });

  it("onvolledige objecten worden niet stil weggelaten maar gemeld; WOZ en verschil € zijn exact, uitsluitend het percentage is op 2 decimalen afgerond", () => {
    const r = bouw({ wozObjecten: [...OBJECTEN, woz({ objectType: null }), woz({ aanslagjaar: 2027, werkelijkeWoz: new Decimal(1) }), woz({ aanslagjaar: 2028, werkelijkeWoz: new Decimal(3) })] });
    expect(r.uitgeslotenObjectIndices).toEqual([3]);
    const regel2027 = r.csv.split("\r\n").find((l) => l.includes(";2027;"))!;
    expect(regel2027).toContain(";1;-1049999;-100,00");
    const regel2028 = r.csv.split("\r\n").find((l) => l.includes(";2028;"))!;
    expect(regel2028.endsWith(";3;2;200,00")).toBe(true);
  });

  it("de volgorde van de invoer verandert de CSV niet", () => {
    expect(bouw({ wozObjecten: [...OBJECTEN].reverse() }).csv).toBe(bouw().csv);
  });
});

describe("bouwWozHistorieCsv — formaat (besluit 2026-09-25)", () => {
  const twee = (vorig: number, nu: number) =>
    bouwWozHistorieCsv({
      administratie: "070",
      wozSetBevestigd: true,
      wozObjecten: [woz({ aanslagjaar: 2025, werkelijkeWoz: new Decimal(vorig) }), woz({ aanslagjaar: 2026, werkelijkeWoz: new Decimal(nu) })],
    });
  const laatsteRegel = (r: ReturnType<typeof twee>) => {
    if (!r.beschikbaar) throw new Error("niet beschikbaar");
    return r.csv.split("\r\n")[2]!;
  };

  it("percentage: altijd precies 2 decimalen, half-up, decimale komma", () => {
    expect(laatsteRegel(twee(3, 4))).toMatch(/;1;33,33$/); // 33,333…
    expect(laatsteRegel(twee(3, 5))).toMatch(/;2;66,67$/); // 66,666… naar boven
    expect(laatsteRegel(twee(2000, 2001))).toMatch(/;1;0,05$/); // 0,05 exact
    expect(laatsteRegel(twee(200000, 200001))).toMatch(/;1;0,00$/); // 0,0005 → 0,00
    expect(laatsteRegel(twee(1000, 1000))).toMatch(/;0;0,00$/);
  });

  it("een negatief resultaat dat op 0 afrondt wordt 0,00 (nooit -0,00); een echte daling houdt het minteken", () => {
    expect(laatsteRegel(twee(200000, 199999))).toMatch(/;-1;0,00$/);
    expect(laatsteRegel(twee(1000, 950))).toMatch(/;-50;-5,00$/);
  });

  it("alle getalcellen gebruiken decimale komma; er komt geen decimale punt in een getalcel", () => {
    const r = bouwWozHistorieCsv({ administratie: "070", wozSetBevestigd: true, wozObjecten: [woz({ werkelijkeWoz: new Decimal("123456.78") })] });
    if (!r.beschikbaar) throw new Error("niet beschikbaar");
    expect(r.csv.split("\r\n")[1]).toBe("070;001;Geheel complex;2026;2025-01-01;123456,78;;");
    expect(r.csv).not.toMatch(/\d\.\d/);
  });

  it("de onderliggende berekening blijft ongerond: alleen de export rondt het percentage af", () => {
    const historie = bepaalWozHistorie([woz({ aanslagjaar: 2025, werkelijkeWoz: new Decimal(3) }), woz({ aanslagjaar: 2026, werkelijkeWoz: new Decimal(4) })]);
    expect(historie.regels[1]!.ontwikkelingPercentage!.toString()).not.toBe("33.33");
    expect(historie.regels[1]!.ontwikkelingPercentage!.toString().length).toBeGreaterThan(10);
  });
});
