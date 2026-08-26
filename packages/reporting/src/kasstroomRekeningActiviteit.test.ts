import type { BalansRegel, GrootboekMappingRegel } from "@bvc/config";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { diagnoseerRekeningActiviteit, type BoekingsregelMetGrootboekAB } from "./kasstroomRekeningActiviteit.js";

function balansRegel(overrides: Partial<BalansRegel> = {}): BalansRegel {
  return {
    grootboekrekening: "1010",
    soort: "BALANS",
    balanszijde: "ACTIVA",
    tekenconventie: "ZOALS_BRON",
    liquideMiddelen: false,
    kasstroomCategorie: null,
    actief: true,
    status: "GOEDGEKEURD",
    ...overrides,
  };
}

let volgnrTeller = 0;
function boeking(
  boekstukSleutel: string,
  grootboeknr: string,
  bedragDebet: string,
  bedragCredit: string,
  boekdatum: string,
  omschrijving = "test",
  dagboeknr = "20",
  grootboekA: string | null = null,
  grootboekB: string | null = null,
): BoekingsregelMetGrootboekAB {
  volgnrTeller += 1;
  return {
    bedrijfsnr: "070",
    boekjaar: 2026,
    dagboeknr,
    boekstuknr: boekstukSleutel,
    volgnr: String(volgnrTeller).padStart(4, "0"),
    boekstukSleutel,
    grootboeknr,
    boekdatum: new Date(boekdatum),
    omschrijving,
    bedragDebet: new Decimal(bedragDebet),
    bedragCredit: new Decimal(bedragCredit),
    grootboekA,
    grootboekB,
  };
}

const mapping: GrootboekMappingRegel[] = [balansRegel({ grootboekrekening: "1010", liquideMiddelen: true }), balansRegel({ grootboekrekening: "1600" }), balansRegel({ grootboekrekening: "1506" })];

describe("diagnoseerRekeningActiviteit", () => {
  it("toont de factuurregistratie (niet kasstroom-relevant) en de latere betaling (wel) chronologisch", () => {
    const boekingen: BoekingsregelMetGrootboekAB[] = [
      boeking("F1", "1506", "31617", "0", "2026-01-26", "BTW Q4 2025", "90"),
      boeking("F1", "1600", "0", "31617", "2026-01-26", "BTW Q4 2025", "90"),
      boeking("B1", "1600", "31617", "0", "2026-02-10", "Betaalbatch week 6", "20"),
      boeking("B1", "1010", "0", "31617", "2026-02-10", "Betaalbatch week 6", "20"),
    ];
    const regels = diagnoseerRekeningActiviteit(boekingen, mapping, "1600");
    expect(regels).toHaveLength(2);
    expect(regels[0]).toMatchObject({ boekstukSleutel: "F1", bedrag: expect.any(Decimal), isKasstroomRelevant: false, omschrijving: "BTW Q4 2025" });
    expect(regels[0]?.bedrag.toString()).toBe("-31617");
    expect(regels[1]).toMatchObject({ boekstukSleutel: "B1", isKasstroomRelevant: true, omschrijving: "Betaalbatch week 6" });
    expect(regels[1]?.bedrag.toString()).toBe("31617");
  });

  it("negeert boekingen op andere rekeningen", () => {
    const boekingen: BoekingsregelMetGrootboekAB[] = [boeking("F1", "1506", "31617", "0", "2026-01-26"), boeking("F1", "1600", "0", "31617", "2026-01-26")];
    const regels = diagnoseerRekeningActiviteit(boekingen, mapping, "1506");
    expect(regels).toHaveLength(1);
    expect(regels[0]?.boekstukSleutel).toBe("F1");
  });

  it("geeft een leeg resultaat als de rekening niet voorkomt", () => {
    const regels = diagnoseerRekeningActiviteit([], mapping, "9999");
    expect(regels).toEqual([]);
  });

  it("geeft Boeking_Grootboek_A/B onveranderd door, zonder er iets mee te matchen", () => {
    const boekingen: BoekingsregelMetGrootboekAB[] = [
      boeking("F1", "1600", "0", "31617", "2026-01-26", "BTW Q4 2025", "90", "1506", "F2026-0142"),
      boeking("B1", "1600", "31617", "0", "2026-02-10", "Betaalbatch week 6", "20", null, "BATCH-2026-06"),
    ];
    const regels = diagnoseerRekeningActiviteit(boekingen, mapping, "1600");
    expect(regels[0]).toMatchObject({ grootboekA: "1506", grootboekB: "F2026-0142" });
    expect(regels[1]).toMatchObject({ grootboekA: null, grootboekB: "BATCH-2026-06" });
  });
});
