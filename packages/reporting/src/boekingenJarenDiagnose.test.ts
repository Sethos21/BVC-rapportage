import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerBoekingenJaren, type BoekingenJarenRegel } from "./boekingenJarenDiagnose.js";

function regel(overrides: Partial<BoekingenJarenRegel>): BoekingenJarenRegel {
  return {
    grootboeknr: "08830",
    boekjaar: 2023,
    boekperiode: "06",
    bedragDebet: new Decimal(0),
    bedragCredit: new Decimal(150000),
    ...overrides,
  };
}

describe("diagnoseerBoekingenJaren", () => {
  it("geen regels -> lege aggregaties, geen fout", () => {
    const resultaat = diagnoseerBoekingenJaren([]);
    expect(resultaat.aantalRegels).toBe(0);
    expect(resultaat.perGrootboekrekening).toEqual([]);
    expect(resultaat.totaalPerBoekjaar).toEqual([]);
  });

  it("bepaalt eerste/laatste periode en aantal regels per boekjaar voor één rekening", () => {
    const regels = [
      regel({ boekjaar: 2023, boekperiode: "03", bedragCredit: new Decimal(100000) }),
      regel({ boekjaar: 2023, boekperiode: "06", bedragCredit: new Decimal(50000) }),
      regel({ boekjaar: 2024, boekperiode: "01", bedragCredit: new Decimal(0) }),
    ];

    const resultaat = diagnoseerBoekingenJaren(regels);

    expect(resultaat.aantalRegels).toBe(3);
    const gl = resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "08830")!;
    expect(gl.aantalRegels).toBe(3);
    expect(gl.saldo.toString()).toBe("-150000");

    const jaar2023 = gl.perJaar.find((j) => j.boekjaar === 2023)!;
    expect(jaar2023).toMatchObject({ eerstePeriode: "03", laatstePeriode: "06", aantalRegels: 2 });
    expect(jaar2023.saldo.toString()).toBe("-150000");

    const jaar2024 = gl.perJaar.find((j) => j.boekjaar === 2024)!;
    expect(jaar2024).toMatchObject({ eerstePeriode: "01", laatstePeriode: "01", aantalRegels: 1 });
  });

  it("houdt meerdere grootboekrekeningen strikt gescheiden (geen vermenging van boekjaren/periodes)", () => {
    const regels = [
      regel({ grootboeknr: "08830", boekjaar: 2023, boekperiode: "06" }),
      regel({ grootboeknr: "00166", boekjaar: 2022, boekperiode: "11", bedragDebet: new Decimal(535000), bedragCredit: new Decimal(0) }),
      regel({ grootboeknr: "00167", boekjaar: 2022, boekperiode: "12", bedragDebet: new Decimal(100000), bedragCredit: new Decimal(0) }),
    ];

    const resultaat = diagnoseerBoekingenJaren(regels);

    expect(resultaat.perGrootboekrekening.map((g) => g.grootboekrekening)).toEqual(["00166", "00167", "08830"]);
    const gl00166 = resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "00166")!;
    expect(gl00166.perJaar).toEqual([{ boekjaar: 2022, eerstePeriode: "11", laatstePeriode: "11", aantalRegels: 1, saldo: new Decimal(535000) }]);
  });

  it("rekening zonder enige boeking komt niet voor in perGrootboekrekening (afwezigheid = geen activiteit ooit)", () => {
    const regels = [regel({ grootboeknr: "08830" })];
    const resultaat = diagnoseerBoekingenJaren(regels);
    expect(resultaat.perGrootboekrekening.map((g) => g.grootboekrekening)).toEqual(["08830"]);
    expect(resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "00166")).toBeUndefined();
  });

  it("totaalPerBoekjaar sommeert over ALLE opgegeven grootboekrekeningen samen, per boekjaar", () => {
    const regels = [
      regel({ grootboeknr: "08830", boekjaar: 2023, bedragCredit: new Decimal(150000) }),
      regel({ grootboeknr: "00166", boekjaar: 2023, bedragDebet: new Decimal(535000), bedragCredit: new Decimal(0) }),
      regel({ grootboeknr: "00167", boekjaar: 2024, bedragDebet: new Decimal(100000), bedragCredit: new Decimal(0) }),
    ];

    const resultaat = diagnoseerBoekingenJaren(regels);

    expect(resultaat.totaalPerBoekjaar).toEqual([
      { boekjaar: 2023, aantalRegels: 2, saldo: new Decimal(385000) },
      { boekjaar: 2024, aantalRegels: 1, saldo: new Decimal(100000) },
    ]);
  });

  it("boekperiode-sortering is lexicografisch op de zero-padded string, niet numeriek geherinterpreteerd", () => {
    const regels = [regel({ boekperiode: "02" }), regel({ boekperiode: "10" }), regel({ boekperiode: "01" })];
    const resultaat = diagnoseerBoekingenJaren(regels);
    const gl = resultaat.perGrootboekrekening.find((g) => g.grootboekrekening === "08830")!;
    expect(gl.perJaar[0]).toMatchObject({ eerstePeriode: "01", laatstePeriode: "10" });
  });
});
