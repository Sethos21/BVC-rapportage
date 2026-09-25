import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { BgWozObjectInvoer } from "./begroteGemeentelijkeLasten.js";
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
    expect(regels[2]).toBe("070;001;Geheel complex;2026;2025-01-01;1050000;50000;5");
    expect(regels[3]).toBe("070;002;A-12;2026;2025-01-01;190000.5;;");
    expect(regels[4]).toBe(""); // sluit af met CRLF
  });

  it("filter op complex en periode; ontwikkeling van het eerste gefilterde jaar blijft t.o.v. het jaar vóór het filter", () => {
    const r = bouw({ filter: { complexnummer: "001", aanslagjaarVan: 2026, aanslagjaarTot: 2026 } });
    expect(r.aantalRegels).toBe(1);
    expect(r.csv.split("\r\n")[1]).toBe("070;001;Geheel complex;2026;2025-01-01;1050000;50000;5");
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

  it("onvolledige objecten worden niet stil weggelaten maar gemeld; bedragen zijn exact (geen afronding)", () => {
    const r = bouw({ wozObjecten: [...OBJECTEN, woz({ objectType: null }), woz({ aanslagjaar: 2027, werkelijkeWoz: new Decimal(1) }), woz({ aanslagjaar: 2028, werkelijkeWoz: new Decimal(3) })] });
    expect(r.uitgeslotenObjectIndices).toEqual([3]);
    const regel2027 = r.csv.split("\r\n").find((l) => l.includes(";2027;"))!;
    expect(regel2027).toContain(";1;-1049999;-99.9999047619047619");
    const regel2028 = r.csv.split("\r\n").find((l) => l.includes(";2028;"))!;
    expect(regel2028.endsWith(";3;2;200")).toBe(true);
  });

  it("de volgorde van de invoer verandert de CSV niet", () => {
    expect(bouw({ wozObjecten: [...OBJECTEN].reverse() }).csv).toBe(bouw().csv);
  });
});
