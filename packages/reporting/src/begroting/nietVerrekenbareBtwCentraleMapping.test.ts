import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { PnLBronmappingRegel } from "../pnlBronmapping.js";
import { berekenWerkelijkNietVerrekenbareBtwViaCentraleMapping, type NietVerrekenbareBtwRuweBoekingRegel } from "./nietVerrekenbareBtwCentraleMapping.js";

/** Werkelijk Niet verrekenbare BTW via de centrale mapping (Vervolgtranche 9 Deel B) — bewezen 070/GL4903 als AANGELEVERDE data, niet als hardcode hier. */

const AANGEMAAKT = new Date("2026-09-29T00:00:00.000Z");
const OP_SYSTEEMTIJDSTIP = new Date("2026-09-29T12:00:00.000Z");

function mapping(overrides: Partial<PnLBronmappingRegel>): PnLBronmappingRegel {
  return {
    bedrijfsnr: "070",
    grootboekrekening: "4903",
    ogbKostensoort: null,
    economischeModule: "NIET_VERREKENBARE_BTW",
    economischeCategorie: "NIET_VERREKENBARE_BTW",
    geldigVanafBoekjaar: 2025,
    geldigVanafPeriode: "01",
    geldigTotBoekjaar: null,
    geldigTotPeriode: null,
    aangemaaktOp: AANGEMAAKT,
    ...overrides,
  };
}

const invoer = { bedrijfsnr: "070", boekjaar: 2026, boekperiode: "12", opSysteemtijdstip: OP_SYSTEEMTIJDSTIP };

describe("berekenWerkelijkNietVerrekenbareBtwViaCentraleMapping", () => {
  it("11. bewezen 070/GL4903 (GL-default) -> NIET_VERREKENBARE_BTW", () => {
    const boekingen: NietVerrekenbareBtwRuweBoekingRegel[] = [{ grootboekrekening: "4903", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal("2450.75") }];
    const { werkelijk, nietGemapt } = berekenWerkelijkNietVerrekenbareBtwViaCentraleMapping(invoer, boekingen, [mapping({})]);
    expect(werkelijk.moduleTotaal.toString()).toBe("2450.75");
    expect(nietGemapt).toEqual([]);
  });

  it("12/13. geen bewezen mapping voor deze administratie -> NIET_GEMAPT, nooit geraden, geen 070-hardcoding elders", () => {
    const boekingen: NietVerrekenbareBtwRuweBoekingRegel[] = [{ grootboekrekening: "4903", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal("100") }];
    const { werkelijk, nietGemapt } = berekenWerkelijkNietVerrekenbareBtwViaCentraleMapping(invoer, boekingen, []);
    expect(werkelijk.moduleTotaal.toString()).toBe("0");
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("100");
    expect(nietGemapt).toEqual([{ grootboekrekening: "4903", ogbKostensoort: null }]);
  });

  it("6/13. administratiegebonden: dezelfde GL bij een andere administratie zonder eigen mapping is ook NIET_GEMAPT — geen kopie van 070 naar andere administraties", () => {
    const boekingen: NietVerrekenbareBtwRuweBoekingRegel[] = [{ grootboekrekening: "4903", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal("100") }];
    const { werkelijk } = berekenWerkelijkNietVerrekenbareBtwViaCentraleMapping({ ...invoer, bedrijfsnr: "071" }, boekingen, [mapping({})]);
    expect(werkelijk.moduleTotaal.toString()).toBe("0");
    expect(werkelijk.nietGeclassificeerdTotaal.toString()).toBe("100");
  });

  it("faalt hard als de resolver een ander hoofddomein teruggeeft (configuratiefout, geen coercie)", () => {
    const boekingen: NietVerrekenbareBtwRuweBoekingRegel[] = [{ grootboekrekening: "4903", ogbKostensoort: null, ogbKostensoortOmschrijving: null, saldo: new Decimal("100") }];
    const foutieveMapping = mapping({ economischeModule: "ALGEMENE_KOSTEN", economischeCategorie: "ALGEMENE_KOSTEN" });
    expect(() => berekenWerkelijkNietVerrekenbareBtwViaCentraleMapping(invoer, boekingen, [foutieveMapping])).toThrow(/configuratiefout/);
  });
});
