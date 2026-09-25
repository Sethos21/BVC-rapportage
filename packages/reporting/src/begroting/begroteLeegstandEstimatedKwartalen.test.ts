import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bepaalLeegstandResterendeVerwachting, type LeegstandEstimatedKwartaalInvoer } from "./begroteLeegstandEstimatedKwartalen.js";
import type { BgLeegstandCategorie } from "./begroteLeegstand.js";

const D = (n: number) => new Decimal(n);
const leeg: LeegstandEstimatedKwartaalInvoer = { q1: null, q2: null, q3: null, q4: null };
const invoer = (o: Partial<Record<BgLeegstandCategorie, LeegstandEstimatedKwartaalInvoer>>): Record<BgLeegstandCategorie, LeegstandEstimatedKwartaalInvoer> => ({
  NUTS_LEEGSTAND: leeg,
  SERVICEKOSTEN_LEEGSTAND: leeg,
  OVERIGE_LEEGSTANDSKOSTEN: leeg,
  ...o,
});

describe("bepaalLeegstandResterendeVerwachting — kwartaalstructuur per kostensoort", () => {
  it("1. som over de resterende kwartalen (Q3 + Q4); een bedrag in het afgesloten Q1 wordt genegeerd (geen dubbele telling met Werkelijk) en gemeld", () => {
    const r = bepaalLeegstandResterendeVerwachting(invoer({ NUTS_LEEGSTAND: { q1: D(999), q2: D(0), q3: D(10), q4: D(20) } }), ["Q3", "Q4"]);
    expect(r.verwachtingPerCategorie.NUTS_LEEGSTAND!.toString()).toBe("30");
    expect(r.controleVereist.some((c) => c.ernst === "INFORMATIEF" && c.bericht.includes("Q1"))).toBe(true);
  });

  it("2. niet ingevuld (null) is geen €0: één leeg resterend kwartaal maakt de kostensoort onbekend; andere kostensoorten blijven bekend", () => {
    const r = bepaalLeegstandResterendeVerwachting(invoer({ NUTS_LEEGSTAND: { q1: null, q2: null, q3: D(10), q4: null }, OVERIGE_LEEGSTANDSKOSTEN: { q1: null, q2: null, q3: D(1), q4: D(2) } }), ["Q3", "Q4"]);
    expect(r.verwachtingPerCategorie.NUTS_LEEGSTAND).toBeNull();
    expect(r.verwachtingPerCategorie.OVERIGE_LEEGSTANDSKOSTEN!.toString()).toBe("3");
    expect(r.verwachtingPerCategorie.SERVICEKOSTEN_LEEGSTAND).toBeNull();
    expect(r.controleVereist.some((c) => c.ernst === "WAARSCHUWING" && c.bericht.includes("NUTS_LEEGSTAND"))).toBe(true);
  });

  it("3. bewust €0 (expliciete Decimal(0)) is geldig en onderscheidbaar van niet ingevuld", () => {
    const r = bepaalLeegstandResterendeVerwachting(invoer({ SERVICEKOSTEN_LEEGSTAND: { q1: null, q2: null, q3: D(0), q4: D(0) } }), ["Q3", "Q4"]);
    expect(r.verwachtingPerCategorie.SERVICEKOSTEN_LEEGSTAND!.isZero()).toBe(true);
  });

  it("4. afgesloten jaar (geen resterende kwartalen): bekende €0 per kostensoort; negatieve bedragen blijven hun teken behouden", () => {
    const klaar = bepaalLeegstandResterendeVerwachting(invoer({}), []);
    expect(Object.values(klaar.verwachtingPerCategorie).every((v) => v !== null && v.isZero())).toBe(true);
    const neg = bepaalLeegstandResterendeVerwachting(invoer({ NUTS_LEEGSTAND: { q1: null, q2: null, q3: null, q4: D(-5) } }), ["Q4"]);
    expect(neg.verwachtingPerCategorie.NUTS_LEEGSTAND!.toString()).toBe("-5");
  });

  it("5. ongeldige of dubbele kwartalen falen hard; volgorde van invoer maakt niet uit", () => {
    expect(() => bepaalLeegstandResterendeVerwachting(invoer({}), ["Q5" as never])).toThrow(/Ongeldig/);
    expect(() => bepaalLeegstandResterendeVerwachting(invoer({}), ["Q3", "Q3"])).toThrow(/meerdere keren/);
    expect(bepaalLeegstandResterendeVerwachting(invoer({}), ["Q4", "Q3"]).resterendeKwartalen).toEqual(["Q3", "Q4"]);
  });
});
