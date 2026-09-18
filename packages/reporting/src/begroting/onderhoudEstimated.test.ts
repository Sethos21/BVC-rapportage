import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenBegroteGeplandOnderhoud, type BgGeplandOnderhoudActiviteitInvoer } from "./begroteGeplandOnderhoud.js";
import { berekenBegroteCorrectiefDagelijksOnderhoud, type BgCorrectiefDagelijksRegelInvoer } from "./begroteCorrectiefDagelijksOnderhoud.js";
import { berekenEstimatedOnderhoud, berekenWerkelijkOnderhoud, type WerkelijkOnderhoudBoekingRegel } from "./werkelijkOnderhoud.js";
import { onderhoudEstimatedNaarPnLBovenEbitdaRegels } from "./onderhoudEstimatedPnLAdapter.js";
import { berekenPnLBoom, type PnLDekkingReden } from "../pnlEngine.js";

/**
 * FASE GAT-008B (2026-09-17) — Estimated Onderhoud: bewijst de zeven
 * genummerde risicopunten uit de opdracht. `berekenEstimatedOnderhoud`
 * ontvangt BEWUST geen Begroting-parameter (zie moduledoc
 * `werkelijkOnderhoud.ts`) — Gepland/Correctief blijven volledig ongewijzigd
 * herbruikbaar om zelf tot een `verwachtingResterendJaar` te komen.
 */

function activiteit(overrides: Partial<BgGeplandOnderhoudActiviteitInvoer> = {}): BgGeplandOnderhoudActiviteitInvoer {
  return {
    complexnummer: "003",
    omschrijving: "Vervangen dakbedekking",
    aanleidingType: "MJOP",
    aanleidingToelichting: "MJOP 2027 regel 14",
    q1: new Decimal(25000),
    q2: new Decimal(0),
    q3: new Decimal(0),
    q4: new Decimal(0),
    status: "GEPLAND",
    ...overrides,
  };
}
function correctiefRegel(overrides: Partial<BgCorrectiefDagelijksRegelInvoer> = {}): BgCorrectiefDagelijksRegelInvoer {
  return { omschrijving: "Dagelijks onderhoud", complexnummer: "003", jaarbedrag: new Decimal(8000), ...overrides };
}
function boeking(overrides: Partial<WerkelijkOnderhoudBoekingRegel> = {}): WerkelijkOnderhoudBoekingRegel {
  return { economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: "003", saldo: new Decimal(0), ...overrides };
}

describe("1. Werkelijk + resterende verwachting = correct Estimated (geen dubbele telling met Begroting)", () => {
  it("estimatedTotaal per categorie = werkelijkTotaal + verwachtingResterendJaar — NOOIT + begroting", () => {
    const werkelijk = berekenWerkelijkOnderhoud([
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", saldo: new Decimal(9000) }),
      boeking({ economischeCategorie: "ONDERHOUD_TERREIN", saldo: new Decimal(1500) }),
    ]);
    const resultaat = berekenEstimatedOnderhoud(werkelijk, true, {
      ONDERHOUD_GEBOUWEN: new Decimal(16000),
      ONDERHOUD_TERREIN: new Decimal(500),
      ONDERHOUD_INSTALLATIES: new Decimal(0),
    });

    const gebouwen = resultaat.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!;
    expect(gebouwen.werkelijkTotaal.toString()).toBe("9000");
    expect(gebouwen.estimatedTotaal!.toString()).toBe("25000"); // 9000 + 16000
    expect(resultaat.moduleEstimatedTotaal!.toString()).toBe("27000"); // 25000 + 2000 + 0
  });
});

describe("2. Begroting wordt niet dubbel geteld of gewijzigd", () => {
  it("berekenEstimatedOnderhoud kent structureel GEEN Begroting-parameter — Gepland/Correctief-bedragen kunnen dus niet per ongeluk worden meegeteld", () => {
    expect(berekenEstimatedOnderhoud.length).toBe(3); // (werkelijk, werkelijkDekkingBevestigd, verwachtingPerCategorie) — geen vierde 'begroting'-argument
  });

  it("berekenBegroteGeplandOnderhoud/berekenBegroteCorrectiefDagelijksOnderhoud blijven byte-ongewijzigd na een Estimated-aanroep (pure functies, geen mutatie)", () => {
    const gepland = berekenBegroteGeplandOnderhoud([activiteit()], { begrotingsjaar: 2027, beoordeeld: true });
    const correctief = berekenBegroteCorrectiefDagelijksOnderhoud([correctiefRegel()], { begrotingsjaar: 2027, beoordeeld: true });
    const geplandVoor = JSON.stringify(gepland, (_k, v) => (v instanceof Decimal ? v.toString() : v));
    const correctiefVoor = JSON.stringify(correctief, (_k, v) => (v instanceof Decimal ? v.toString() : v));

    const werkelijk = berekenWerkelijkOnderhoud([boeking({ saldo: new Decimal(9000) })]);
    berekenEstimatedOnderhoud(werkelijk, true, { ONDERHOUD_GEBOUWEN: new Decimal(16000), ONDERHOUD_TERREIN: new Decimal(0), ONDERHOUD_INSTALLATIES: new Decimal(0) });

    expect(JSON.stringify(gepland, (_k, v) => (v instanceof Decimal ? v.toString() : v))).toBe(geplandVoor);
    expect(JSON.stringify(correctief, (_k, v) => (v instanceof Decimal ? v.toString() : v))).toBe(correctiefVoor);
    // gepland.totaalJaar (25.000) + correctief-jaarbedrag (8.000) komen NERGENS voor in het Estimated-resultaat hierboven (27.000 zonder deze twee bedragen).
    expect(gepland.totaalJaar.toString()).toBe("25000");
    expect(correctief.totaalJaar.toString()).toBe("8000");
  });
});

describe("3. Werkelijke boekingen worden niet kunstmatig aan onderhoudsactiviteiten gekoppeld", () => {
  it("WerkelijkOnderhoudBoekingRegel kent geen enkel veld dat naar een Gepland-/Correctief-activiteit/-regel verwijst", () => {
    const b: WerkelijkOnderhoudBoekingRegel = boeking({ saldo: new Decimal(100) });
    expect(Object.keys(b).sort()).toEqual(["complexnummer", "economischeCategorie", "saldo"]);
  });
});

describe("4. wijzigingen/uitstel/vervallen en Estimated-only activiteiten beïnvloeden de resterende verwachting correct", () => {
  it("een vastgestelde Gepland-Onderhoud-lijst versus een bijgestelde 'Estimated-versie' (bestaande activiteit uitgesteld, nieuwe ONVOORZIEN-activiteit toegevoegd) geeft een ander, voorspelbaar totaalJaar — en DAT getal (niet de oorspronkelijke Begroting) voedt verwachtingResterendJaar", () => {
    const vastgesteldeBegroting = berekenBegroteGeplandOnderhoud(
      [activiteit({ omschrijving: "Vervangen dakbedekking", q3: new Decimal(25000), q1: new Decimal(0) })],
      { begrotingsjaar: 2027, beoordeeld: true },
    );
    expect(vastgesteldeBegroting.totaalJaar.toString()).toBe("25000");

    // Estimated-versie: de dakbedekking wordt uitgesteld naar volgend jaar (q3 -> 0), en er komt een
    // onvoorziene lekkage-reparatie bij — beide via de BESTAANDE, ongewijzigde activiteiten-invoervorm.
    const estimatedVersieGepland = berekenBegroteGeplandOnderhoud(
      [
        activiteit({ omschrijving: "Vervangen dakbedekking", q3: new Decimal(0), q1: new Decimal(0), status: "UITGESTELD" }),
        activiteit({ omschrijving: "Lekkage reparatie dak (onvoorzien)", q1: new Decimal(0), q3: new Decimal(0), q4: new Decimal(4000), status: "ONVOORZIEN", aanleidingType: "ERVARING_BEHEERDER" }),
      ],
      { begrotingsjaar: 2027, beoordeeld: true },
    );
    expect(estimatedVersieGepland.totaalJaar.toString()).toBe("4000"); // 0 (uitgesteld) + 4000 (onvoorzien)

    const werkelijk = berekenWerkelijkOnderhoud([boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", saldo: new Decimal(9000) })]);
    const resultaatMetUitstel = berekenEstimatedOnderhoud(werkelijk, true, {
      ONDERHOUD_GEBOUWEN: estimatedVersieGepland.totaalJaar,
      ONDERHOUD_TERREIN: new Decimal(0),
      ONDERHOUD_INSTALLATIES: new Decimal(0),
    });
    expect(resultaatMetUitstel.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.estimatedTotaal!.toString()).toBe("13000"); // 9000 + 4000

    // Zonder de uitstel/onvoorzien-bijstelling (de oorspronkelijke, vastgestelde 25.000) zou Estimated hoger uitkomen — het verschil bewijst dat de bijstelling daadwerkelijk doorwerkt.
    const resultaatZonderBijstelling = berekenEstimatedOnderhoud(werkelijk, true, {
      ONDERHOUD_GEBOUWEN: vastgesteldeBegroting.totaalJaar,
      ONDERHOUD_TERREIN: new Decimal(0),
      ONDERHOUD_INSTALLATIES: new Decimal(0),
    });
    expect(resultaatZonderBijstelling.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.estimatedTotaal!.toString()).toBe("34000"); // 9000 + 25000
    expect(resultaatZonderBijstelling.moduleEstimatedTotaal!.minus(resultaatMetUitstel.moduleEstimatedTotaal!).toString()).toBe("21000");
  });
});

describe("5. ontbrekende resterende verwachting wordt niet stilzwijgend €0", () => {
  it("verwachtingResterendJaar=null voor één categorie -> estimatedTotaal blijft null voor die categorie EN voor het moduletotaal", () => {
    const werkelijk = berekenWerkelijkOnderhoud([boeking({ saldo: new Decimal(9000) })]);
    const resultaat = berekenEstimatedOnderhoud(werkelijk, true, { ONDERHOUD_GEBOUWEN: null, ONDERHOUD_TERREIN: new Decimal(0), ONDERHOUD_INSTALLATIES: new Decimal(0) });

    expect(resultaat.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.estimatedTotaal).toBeNull();
    expect(resultaat.moduleEstimatedTotaal).toBeNull();
  });

  it("onvolledige Werkelijk-dekking (brondekking niet bevestigd) maakt Estimated niet volledig bekend, ondanks een ingevulde verwachting", () => {
    const werkelijk = berekenWerkelijkOnderhoud([boeking({ saldo: new Decimal(9000) })]);
    const resultaat = berekenEstimatedOnderhoud(werkelijk, false, { ONDERHOUD_GEBOUWEN: new Decimal(16000), ONDERHOUD_TERREIN: new Decimal(0), ONDERHOUD_INSTALLATIES: new Decimal(0) });
    expect(resultaat.perCategorie.every((c) => c.estimatedTotaal === null)).toBe(true);
  });

  it("nietGeclassificeerdTotaal != 0 maakt Estimated niet volledig bekend, zelfs met werkelijkDekkingBevestigd=true", () => {
    const werkelijk = berekenWerkelijkOnderhoud([boeking({ saldo: new Decimal(9000) }), boeking({ economischeCategorie: null, saldo: new Decimal(200) })]);
    const resultaat = berekenEstimatedOnderhoud(werkelijk, true, { ONDERHOUD_GEBOUWEN: new Decimal(16000), ONDERHOUD_TERREIN: new Decimal(0), ONDERHOUD_INSTALLATIES: new Decimal(0) });
    expect(resultaat.perCategorie.every((c) => c.estimatedTotaal === null)).toBe(true);
  });
});

describe("6. bestaande onderhoudspresentatie en EBITDA-werking blijven intact", () => {
  it("Estimated Onderhoud komt terecht als drie afzonderlijke regels (Gebouwen/Terrein/Installaties) in EXPLOITATIE_LASTEN, boven EBITDA, als KOSTEN — geen nieuwe Gepland/Correctief-P&L-indeling", () => {
    const werkelijk = berekenWerkelijkOnderhoud([
      boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", saldo: new Decimal(9000) }),
      boeking({ economischeCategorie: "ONDERHOUD_TERREIN", saldo: new Decimal(1500) }),
    ]);
    const estimated = berekenEstimatedOnderhoud(werkelijk, true, { ONDERHOUD_GEBOUWEN: new Decimal(16000), ONDERHOUD_TERREIN: new Decimal(500), ONDERHOUD_INSTALLATIES: new Decimal(0) });
    const regels = onderhoudEstimatedNaarPnLBovenEbitdaRegels(estimated);

    expect(regels).toHaveLength(3);
    expect(regels.map((r) => r.regelSleutel).sort()).toEqual(["ONDERHOUD_GEBOUWEN", "ONDERHOUD_INSTALLATIES", "ONDERHOUD_TERREIN"]);
    expect(regels.every((r) => r.boomPositie === "BOVEN_EBITDA" && r.groep === "EXPLOITATIE_LASTEN" && r.contributieAard === "KOSTEN")).toBe(true);
  });

  it("EBITDA gebruikt Estimated correct wanneer waardesoort ESTIMATED wordt berekend, onder-EBITDA-regels blijven onaangetast", () => {
    const werkelijk = berekenWerkelijkOnderhoud([boeking({ economischeCategorie: "ONDERHOUD_GEBOUWEN", saldo: new Decimal(9000) })]);
    const estimated = berekenEstimatedOnderhoud(werkelijk, true, { ONDERHOUD_GEBOUWEN: new Decimal(16000), ONDERHOUD_TERREIN: new Decimal(0), ONDERHOUD_INSTALLATIES: new Decimal(0) });
    const kostenRegels = onderhoudEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const opbrengstRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA" as const, groep: "OPBRENGSTEN" as const, contributieAard: "OPBRENGST" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(100000) } };
    const rentekosten = { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA" as const, contributieAard: "KOSTEN" as const, waarde: { status: "BEKEND" as const, bedrag: new Decimal(50000) } };

    const pnl = berekenPnLBoom("ESTIMATED", [opbrengstRegel, ...kostenRegels, rentekosten]);
    expect(pnl.waardesoort).toBe("ESTIMATED");
    expect(pnl.exploitatieLasten.besteWetenSom.toString()).toBe("25000");
    expect(pnl.onderEbitda).toHaveLength(1);
    expect(pnl.ebitda.bedrag.toString()).toBe("75000"); // 100000 - 25000, rentekosten blijven buiten EBITDA
    expect(pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("een niet-bekende Estimated-bijdrage maakt EXPLOITATIE_LASTEN en EBITDA ONVOLLEDIG, met de juiste PnLDekkingReden", () => {
    const werkelijk = berekenWerkelijkOnderhoud([boeking({ saldo: new Decimal(9000) })]);
    const estimated = berekenEstimatedOnderhoud(werkelijk, true, { ONDERHOUD_GEBOUWEN: null, ONDERHOUD_TERREIN: new Decimal(0), ONDERHOUD_INSTALLATIES: new Decimal(0) });
    const regels = onderhoudEstimatedNaarPnLBovenEbitdaRegels(estimated);
    const gebouwen = regels.find((r) => r.regelSleutel === "ONDERHOUD_GEBOUWEN")!;
    expect(gebouwen.waarde.status).toBe("ONBEKEND");
    expect((gebouwen.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("GEEN_BEOORDELING");

    const pnl = berekenPnLBoom("ESTIMATED", regels);
    expect(pnl.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(pnl.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });
});
