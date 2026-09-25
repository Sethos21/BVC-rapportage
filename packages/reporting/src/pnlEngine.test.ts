import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  berekenPnLBoom,
  vergelijkPnLResultaten,
  type PnLBronBijdrage,
  type PnLDekkingReden,
  type PurePnLBovenEbitdaRegel,
  type PurePnLBronRegel,
  type PurePnLOnderEbitdaRegel,
} from "./pnlEngine.js";
import { berekenWerkelijkRente, type WerkelijkRenteResultaat } from "./begroting/begroteRente.js";
import { berekenWerkelijkLeegstand, type WerkelijkLeegstandBoekingRegel, type WerkelijkLeegstandResultaat } from "./begroting/begroteLeegstand.js";
import { berekenWerkelijkVerzekeringen, type WerkelijkVerzekeringBoekingRegel, type WerkelijkVerzekeringResultaat } from "./begroting/begroteVerzekeringen.js";

/**
 * FASE EBITDA-GAT-001B (2026-09-16) — testbewijs voor de pure P&L-/EBITDA-
 * engine (`pnlEngine.ts`). Zie dat bestand voor de volledige moduledoc; hier
 * uitsluitend het testbewijs, in de letters A–T zoals opgedragen.
 *
 * BEWIJS-ADAPTERS HIERONDER ZIJN TEST-LOKAAL EN NIET GEËXPORTEERD ALS
 * PRODUCTIECODE (§13/§16 van de opdracht — "niet onderweg alsnog calculators
 * bouwen", geen productiewiring). Ze demonstreren uitsluitend dat een
 * bestaande, reeds-bewezen Werkelijk-calculator (Rente, Leegstand,
 * Verzekeringen — bewust gekozen omdat Rente ONDER EBITDA hoort en Leegstand/
 * Verzekeringen BOVEN EBITDA, wat precies de scheiding bewijst) een
 * `PurePnLBronRegel[]` kan opleveren zonder dat de engine zelf ooit een GL/
 * OGB/administratiecode ziet.
 *
 * Tekennormalisatie (§3): gebeurt hier, ÉÉN KEER, gestuurd door de VASTE
 * contributieAard van de categorie — nooit afgeleid uit het teken van
 * `categorieTotaal` zelf. Voor KOSTEN-categorieën is CAL-FIN-001's ruwe
 * saldo al positief (geen transformatie nodig); voor OPBRENGST-categorieën
 * wordt het ruwe (negatieve) saldo hier eenmalig genegeerd.
 */

function bekend(bedrag: Decimal): PnLBronBijdrage {
  return { status: "BEKEND", bedrag };
}
function onbekend(dekkingReden: PnLDekkingReden, toelichting: string): PnLBronBijdrage {
  return { status: "ONBEKEND", dekkingReden, toelichting };
}

/**
 * Rente is de ONDER-EBITDA-bewijsmodule. `brondekkingBevestigd` simuleert de
 * expliciete adapterbeslissing die §5 eist: volledigheid mag NOOIT alleen uit
 * `nietGeclassificeerdTotaal` worden afgeleid. Wanneer de aanroeper dekking
 * niet bevestigt, is de regel ONBEKEND, ONGEACHT wat `nietGeclassificeerdTotaal`
 * zegt (bewijst test O). Wanneer dekking wél bevestigd is, blokkeert een
 * niet-nul `nietGeclassificeerdTotaal` alsnog (bewijst test N) — beide
 * voorwaarden moeten gelden voor BEKEND.
 */
function renteOnderEbitdaRegels(resultaat: WerkelijkRenteResultaat, brondekkingBevestigd: boolean): PurePnLOnderEbitdaRegel[] {
  function regel(regelSleutel: string, categorie: "RENTEKOSTEN" | "RENTE_OPBRENGSTEN", contributieAard: "KOSTEN" | "OPBRENGST"): PurePnLOnderEbitdaRegel {
    const categorieResultaat = resultaat.perCategorie.find((c) => c.categorie === categorie)!;
    if (!brondekkingBevestigd) {
      return { regelSleutel, boomPositie: "ONDER_EBITDA", contributieAard, waarde: onbekend("GEEN_BEOORDELING", "Adapter heeft brondekking niet bevestigd.") };
    }
    if (!resultaat.nietGeclassificeerdTotaal.isZero()) {
      return {
        regelSleutel,
        boomPositie: "ONDER_EBITDA",
        contributieAard,
        waarde: onbekend("NIET_GEMAPT", `Rente-Werkelijk heeft een niet-geclassificeerd totaal van ${resultaat.nietGeclassificeerdTotaal.toString()}.`),
      };
    }
    // Normalisatie, exact één keer, gestuurd door contributieAard: OPBRENGST-categorieën komen
    // volgens CAL-FIN-001 negatief door en worden hier eenmalig genegeerd; KOSTEN blijft ongewijzigd.
    const bedrag = contributieAard === "OPBRENGST" ? categorieResultaat.categorieTotaal.negated() : categorieResultaat.categorieTotaal;
    return { regelSleutel, boomPositie: "ONDER_EBITDA", contributieAard, waarde: bekend(bedrag) };
  }
  return [regel("RENTEKOSTEN", "RENTEKOSTEN", "KOSTEN"), regel("RENTE_OPBRENGSTEN", "RENTE_OPBRENGSTEN", "OPBRENGST")];
}

/** Leegstand is een BOVEN-EBITDA-bewijsmodule (EXPLOITATIE_LASTEN, uitsluitend KOSTEN-categorieën). */
function leegstandBovenEbitdaRegel(resultaat: WerkelijkLeegstandResultaat): PurePnLBovenEbitdaRegel {
  if (!resultaat.nietGeclassificeerdTotaal.isZero()) {
    return {
      regelSleutel: "LEEGSTAND",
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: onbekend("NIET_GEMAPT", `Leegstand-Werkelijk heeft een niet-geclassificeerd totaal van ${resultaat.nietGeclassificeerdTotaal.toString()}.`),
    };
  }
  return { regelSleutel: "LEEGSTAND", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(resultaat.moduleTotaal) };
}

/** Verzekeringen is de tweede BOVEN-EBITDA-bewijsmodule (EXPLOITATIE_LASTEN). */
function verzekeringenBovenEbitdaRegel(resultaat: WerkelijkVerzekeringResultaat): PurePnLBovenEbitdaRegel {
  if (!resultaat.nietGeclassificeerdTotaal.isZero()) {
    return {
      regelSleutel: "VERZEKERINGEN",
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: onbekend("NIET_GEMAPT", `Verzekeringen-Werkelijk heeft een niet-geclassificeerd totaal van ${resultaat.nietGeclassificeerdTotaal.toString()}.`),
    };
  }
  return { regelSleutel: "VERZEKERINGEN", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(resultaat.moduleTotaal) };
}

function huurRegels(): PurePnLBovenEbitdaRegel[] {
  return [
    { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(200000)) },
    { regelSleutel: "HUUROPBRENGST_ONBELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(50000)) },
    // Huurkorting is een NEGATIEVE bijdrage binnen de OPBRENGSTEN-groep — contributieAard blijft
    // "OPBRENGST" (het is geen kostenpost), het bedrag is negatief omdat het de opbrengst verlaagt.
    { regelSleutel: "VERLEENDE_HUURKORTING", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(-3000)) },
  ];
}

describe("berekenPnLBoom — A. complete eenvoudige EBITDA", () => {
  it("één opbrengstregel en één kostenregel geven het verwachte EBITDA, volledig", () => {
    const regels: PurePnLBronRegel[] = [
      { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(100000)) },
      { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(30000)) },
    ];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);

    expect(resultaat.totaalOpbrengsten.besteWetenSom.toString()).toBe("100000");
    expect(resultaat.totaalKosten.besteWetenSom.toString()).toBe("30000");
    expect(resultaat.ebitda.bedrag.toString()).toBe("70000");
    expect(resultaat.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });
});

describe("berekenPnLBoom — B. Huur belast + onbelast + huurkorting", () => {
  it("de drie huurregels tellen samen op tot Totaal opbrengsten (korting verlaagt, geen aparte kostenpost)", () => {
    const resultaat = berekenPnLBoom("WERKELIJK", huurRegels());
    expect(resultaat.totaalOpbrengsten.besteWetenSom.toString()).toBe("247000"); // 200000 + 50000 - 3000
    expect(resultaat.totaalOpbrengsten.volledigheid).toEqual({ status: "VOLLEDIG" });
  });
});

describe("berekenPnLBoom — C. meerdere kostengroepen en subtotalen", () => {
  it("Totaal kosten is de som van MANAGEMENT_EN_BEHEER + EXPLOITATIE_LASTEN + ALGEMENE_KOSTEN, elk als eigen subtotaal beschikbaar", () => {
    const regels: PurePnLBronRegel[] = [
      { regelSleutel: "BEHEER", boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde: bekend(new Decimal(12000)) },
      { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(30000)) },
      { regelSleutel: "VERZEKERINGEN", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(5000)) },
      { regelSleutel: "ACCOUNTANT", boomPositie: "BOVEN_EBITDA", groep: "ALGEMENE_KOSTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(2500)) },
    ];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);

    expect(resultaat.managementEnBeheer.besteWetenSom.toString()).toBe("12000");
    expect(resultaat.exploitatieLasten.besteWetenSom.toString()).toBe("35000");
    expect(resultaat.algemeneKosten.besteWetenSom.toString()).toBe("2500");
    expect(resultaat.totaalKosten.besteWetenSom.toString()).toBe("49500");
    expect(resultaat.totaalKosten.regels).toHaveLength(4);
  });
});

describe("berekenPnLBoom — D/P. Onderhoud hoofdregel + specificaties: geen dubbele telling, geen valse dimensie", () => {
  it("D. specificaties tellen NOOIT zelfstandig mee — alleen de hoofdregel telt in het subtotaal", () => {
    const hoofdregelBedrag = new Decimal(30000);
    const regel: PurePnLBovenEbitdaRegel = {
      regelSleutel: "ONDERHOUD",
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: bekend(hoofdregelBedrag),
      specificaties: [
        { label: "Gebouwen", waarde: bekend(new Decimal(20000)) },
        { label: "Terrein", waarde: bekend(new Decimal(6000)) },
        { label: "Installaties", waarde: bekend(new Decimal(4000)) },
      ],
    };
    const resultaat = berekenPnLBoom("WERKELIJK", [regel]);
    // Som van specificaties (30000) is hier toevallig gelijk aan de hoofdregel — het bewijs zit in
    // test P (verschillende specificatiedimensies, zelfde hoofdoptelling), niet in deze gelijkheid.
    expect(resultaat.exploitatieLasten.besteWetenSom.toString()).toBe(hoofdregelBedrag.toString());
    expect(resultaat.exploitatieLasten.regels[0]!.specificaties).toHaveLength(3);
  });

  it("P. Begroting (Gepland/Correctief) en Werkelijk (Gebouwen/Terrein/Installaties) mogen een structureel andere specificatiedimensie gebruiken — de hoofdoptelling blijft gelijk", () => {
    const gemeenschappelijkBedrag = new Decimal(30000);
    const begrotingRegel: PurePnLBovenEbitdaRegel = {
      regelSleutel: "ONDERHOUD",
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: bekend(gemeenschappelijkBedrag),
      specificaties: [
        { label: "Gepland onderhoud", waarde: bekend(new Decimal(22000)) },
        { label: "Correctief onderhoud", waarde: bekend(new Decimal(8000)) },
      ],
    };
    const werkelijkRegel: PurePnLBovenEbitdaRegel = {
      regelSleutel: "ONDERHOUD",
      boomPositie: "BOVEN_EBITDA",
      groep: "EXPLOITATIE_LASTEN",
      contributieAard: "KOSTEN",
      waarde: bekend(gemeenschappelijkBedrag),
      specificaties: [
        { label: "Gebouwen", waarde: bekend(new Decimal(20000)) },
        { label: "Terrein", waarde: bekend(new Decimal(6000)) },
        { label: "Installaties", waarde: bekend(new Decimal(4000)) },
      ],
    };

    const resultaatBegroting = berekenPnLBoom("BEGROTING_NIEUW_JAAR", [begrotingRegel]);
    const resultaatWerkelijk = berekenPnLBoom("WERKELIJK", [werkelijkRegel]);

    expect(resultaatBegroting.exploitatieLasten.besteWetenSom.toString()).toBe(resultaatWerkelijk.exploitatieLasten.besteWetenSom.toString());
    expect(resultaatBegroting.totaalKosten.besteWetenSom.toString()).toBe(resultaatWerkelijk.totaalKosten.besteWetenSom.toString());
  });
});

describe("berekenPnLBoom — E. Niet verrekenbare BTW verlaagt EBITDA", () => {
  it("een bekende BTW-kostenregel verlaagt EBITDA met exact haar eigen bedrag", () => {
    const opbrengstRegel: PurePnLBronRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(100000)) };
    const btwRegel: PurePnLBronRegel = { regelSleutel: "NIET_VERREKENBARE_BTW", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(4200)) };

    const zonderBtw = berekenPnLBoom("WERKELIJK", [opbrengstRegel]);
    const metBtw = berekenPnLBoom("WERKELIJK", [opbrengstRegel, btwRegel]);

    expect(zonderBtw.ebitda.bedrag.toString()).toBe("100000");
    expect(metBtw.ebitda.bedrag.toString()).toBe("95800");
    expect(zonderBtw.ebitda.bedrag.minus(metBtw.ebitda.bedrag).toString()).toBe("4200");
  });
});

describe("berekenPnLBoom — F/G/N/O. Rente (onder EBITDA) via echte bewijs-adapter — bewezen bronproef 023/013", () => {
  const RENTE_023: WerkelijkRenteResultaat = berekenWerkelijkRente(
    [
      { ogbKostensoort: "4601", saldo: new Decimal("522837.15") },
      { ogbKostensoort: "4602", saldo: new Decimal("49045.59") },
      { ogbKostensoort: "4603", saldo: new Decimal("104989.35") },
      { ogbKostensoort: "4604", saldo: new Decimal("66211.49") },
      { ogbKostensoort: "4606", saldo: new Decimal("357440.93") },
      { ogbKostensoort: "4620", saldo: new Decimal("48000") },
    ],
    [
      { ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4602", ogbKostensoortOmschrijving: "Rente en Provisie ING R/C", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4603", ogbKostensoortOmschrijving: "Rente lening .586", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente lening .500", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4606", ogbKostensoortOmschrijving: "rente lening 747", categorie: "RENTEKOSTEN" },
      { ogbKostensoort: "4620", ogbKostensoortOmschrijving: "Overige rentes", categorie: "RENTEKOSTEN" },
    ],
  );

  const RENTE_013: WerkelijkRenteResultaat = berekenWerkelijkRente(
    [
      { ogbKostensoort: "4604", saldo: new Decimal("-1215.67") },
      { ogbKostensoort: "4621", saldo: new Decimal("-34.42") },
    ],
    [
      { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" },
      { ogbKostensoort: "4621", ogbKostensoortOmschrijving: "Rente opbrengst telerek", categorie: "RENTE_OPBRENGSTEN" },
    ],
  );

  it("F/G. Rentekosten (€1.148.524,51) en Renteopbrengsten (-€1.250,09 -> genormaliseerd €1.250,09) staan alleen in onderEbitda en beïnvloeden EBITDA niet", () => {
    const opbrengstRegel: PurePnLBronRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(100000)) };

    const zonderRente = berekenPnLBoom("WERKELIJK", [opbrengstRegel]);
    const metRente = berekenPnLBoom("WERKELIJK", [opbrengstRegel, ...renteOnderEbitdaRegels(RENTE_023, true), ...renteOnderEbitdaRegels(RENTE_013, true)]);

    expect(zonderRente.ebitda.bedrag.toString()).toBe(metRente.ebitda.bedrag.toString());
    expect(zonderRente.totaalKosten.besteWetenSom.toString()).toBe(metRente.totaalKosten.besteWetenSom.toString());
    expect(zonderRente.totaalOpbrengsten.besteWetenSom.toString()).toBe(metRente.totaalOpbrengsten.besteWetenSom.toString());

    const rentekosten = metRente.onderEbitda.find((r) => r.regelSleutel === "RENTEKOSTEN")!;
    const renteOpbrengsten = metRente.onderEbitda.find((r) => r.regelSleutel === "RENTE_OPBRENGSTEN" && r.waarde.status === "BEKEND" && r.waarde.bedrag.toString() === "1250.09");
    expect((rentekosten.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("1148524.51");
    expect(renteOpbrengsten).toBeDefined();
  });

  it("N. nietGeclassificeerdTotaal != 0 -> de Rente-onder-EBITDA-regel is ONBEKEND, ongeacht bevestigde dekking", () => {
    const rentaMetGat = berekenWerkelijkRente(
      [
        { ogbKostensoort: "4601", saldo: new Decimal("522837.15") },
        { ogbKostensoort: "9999", saldo: new Decimal("500") }, // onbekende OGB -> niet geclassificeerd
      ],
      [{ ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" }],
    );
    expect(rentaMetGat.nietGeclassificeerdTotaal.toString()).toBe("500");

    const [rentekostenRegel] = renteOnderEbitdaRegels(rentaMetGat, true);
    expect(rentekostenRegel!.waarde.status).toBe("ONBEKEND");
    expect((rentekostenRegel!.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");
  });

  it("O. nietGeclassificeerdTotaal === 0, maar de adapter zelf bevestigt geen dekking -> de regel blijft ONBEKEND (nietGeclassificeerdTotaal==0 is NOODZAKELIJK, NIET VOLDOENDE)", () => {
    expect(RENTE_023.nietGeclassificeerdTotaal.toString()).toBe("0");
    const [rentekostenRegel] = renteOnderEbitdaRegels(RENTE_023, false);
    expect(rentekostenRegel!.waarde.status).toBe("ONBEKEND");
    expect((rentekostenRegel!.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("GEEN_BEOORDELING");
  });
});

describe("berekenPnLBoom — H/I/J/S. Onder-EBITDA-posten (Zonnestroom/Verkoopresultaat/Waardemutatie) beïnvloeden EBITDA nooit", () => {
  const bovenEbitdaRegels: PurePnLBronRegel[] = [
    { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(100000)) },
    { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(30000)) },
  ];

  it("H. Zonnestroom/bijzondere extra opbrengst (generiek, GEEN 070-hardcode) heeft geen effect op EBITDA", () => {
    const zonnestroomRegel: PurePnLOnderEbitdaRegel = { regelSleutel: "ZONNESTROOM", boomPositie: "ONDER_EBITDA", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(9999999)) };
    const zonder = berekenPnLBoom("WERKELIJK", bovenEbitdaRegels);
    const met = berekenPnLBoom("WERKELIJK", [...bovenEbitdaRegels, zonnestroomRegel]);
    expect(met.ebitda.bedrag.toString()).toBe(zonder.ebitda.bedrag.toString());
    expect(met.onderEbitda.map((r) => r.regelSleutel)).toContain("ZONNESTROOM");
  });

  it("I. Verkoopresultaat heeft geen effect op EBITDA", () => {
    const verkoopRegel: PurePnLOnderEbitdaRegel = { regelSleutel: "VERKOOPRESULTAAT", boomPositie: "ONDER_EBITDA", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(500000)) };
    const zonder = berekenPnLBoom("WERKELIJK", bovenEbitdaRegels);
    const met = berekenPnLBoom("WERKELIJK", [...bovenEbitdaRegels, verkoopRegel]);
    expect(met.ebitda.bedrag.toString()).toBe(zonder.ebitda.bedrag.toString());
  });

  it("J. Waardemutatie heeft geen effect op EBITDA", () => {
    const waardemutatieRegel: PurePnLOnderEbitdaRegel = { regelSleutel: "WAARDEMUTATIE", boomPositie: "ONDER_EBITDA", contributieAard: "KOSTEN", waarde: bekend(new Decimal(75000)) };
    const zonder = berekenPnLBoom("WERKELIJK", bovenEbitdaRegels);
    const met = berekenPnLBoom("WERKELIJK", [...bovenEbitdaRegels, waardemutatieRegel]);
    expect(met.ebitda.bedrag.toString()).toBe(zonder.ebitda.bedrag.toString());
  });

  it("S. willekeurig grote onder-EBITDA-posten (opbrengst én kosten) laten totaalOpbrengsten/totaalKosten/ebitda structureel ongewijzigd", () => {
    const zonder = berekenPnLBoom("WERKELIJK", bovenEbitdaRegels);
    const metVeelOnderEbitda: PurePnLBronRegel[] = [
      ...bovenEbitdaRegels,
      { regelSleutel: "RENTEKOSTEN", boomPositie: "ONDER_EBITDA", contributieAard: "KOSTEN", waarde: bekend(new Decimal(1148524.51)) },
      { regelSleutel: "ZONNESTROOM", boomPositie: "ONDER_EBITDA", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(9999999)) },
      { regelSleutel: "VERKOOPRESULTAAT", boomPositie: "ONDER_EBITDA", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(500000)) },
      { regelSleutel: "WAARDEMUTATIE", boomPositie: "ONDER_EBITDA", contributieAard: "KOSTEN", waarde: bekend(new Decimal(75000)) },
    ];
    const met = berekenPnLBoom("WERKELIJK", metVeelOnderEbitda);

    expect(met.totaalOpbrengsten.besteWetenSom.toString()).toBe(zonder.totaalOpbrengsten.besteWetenSom.toString());
    expect(met.totaalKosten.besteWetenSom.toString()).toBe(zonder.totaalKosten.besteWetenSom.toString());
    expect(met.ebitda.bedrag.toString()).toBe(zonder.ebitda.bedrag.toString());
    expect(met.onderEbitda).toHaveLength(4);
  });
});

describe("berekenPnLBoom — K/L/M/T. Volledigheid: unknown != zero, bekende deelsom blijft beschikbaar", () => {
  it("K. een TECHNISCH_NIET_ONDERSTEUNDE, resultaatbepalende regel maakt EBITDA ONVOLLEDIG", () => {
    const regels: PurePnLBronRegel[] = [
      { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: onbekend("TECHNISCH_NIET_ONDERSTEUND", "Nog geen Werkelijk-calculator voor Huur (M8, buiten scope 001B).") },
      { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(30000)) },
    ];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);
    expect(resultaat.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
    expect(resultaat.totaalOpbrengsten.volledigheid).toEqual({
      status: "ONVOLLEDIG",
      ontbrekend: [{ regelSleutel: "HUUROPBRENGST_BELAST", reden: "TECHNISCH_NIET_ONDERSTEUND", toelichting: "Nog geen Werkelijk-calculator voor Huur (M8, buiten scope 001B)." }],
    });
  });

  it("L. een bewust vastgesteld €0-bedrag (BEKEND) is VOLLEDIG, niet ONVOLLEDIG", () => {
    const regel: PurePnLBronRegel = { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(0)) };
    const resultaat = berekenPnLBoom("WERKELIJK", [regel]);
    expect(resultaat.exploitatieLasten.volledigheid).toEqual({ status: "VOLLEDIG" });
    expect(resultaat.exploitatieLasten.besteWetenSom.toString()).toBe("0");
  });

  it("M. NIET_GEMAPT maakt EBITDA ONVOLLEDIG (net als TECHNISCH_NIET_ONDERSTEUND, andere reden)", () => {
    const regel: PurePnLBronRegel = { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: onbekend("NIET_GEMAPT", "GL4350 heeft nog geen bewezen hoofddomein (EBITDA-GAT-006).") };
    const resultaat = berekenPnLBoom("WERKELIJK", [regel]);
    expect(resultaat.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });

  it("T. bekende deelsom (besteWetenSom) blijft beschikbaar terwijl het totaalcijfer ONVOLLEDIG is — een renderer mag deze nooit als 'compleet' aanzien", () => {
    const regels: PurePnLBronRegel[] = [
      { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(10000)) },
      { regelSleutel: "VERZEKERINGEN", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(5000)) },
      { regelSleutel: "NIET_VERREKENBARE_BTW", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: onbekend("TECHNISCH_NIET_ONDERSTEUND", "Nog geen Werkelijk-calculator voor BTW.") },
    ];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);
    // Precies het voorbeeld uit §6 van de opdracht: bekende deelsom €15.000 blijft technisch
    // beschikbaar, maar volledigheid is ONVOLLEDIG — nooit stilzwijgend als "compleet" te lezen.
    expect(resultaat.exploitatieLasten.besteWetenSom.toString()).toBe("15000");
    expect(resultaat.exploitatieLasten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(resultaat.totaalKosten.besteWetenSom.toString()).toBe("15000");
    expect(resultaat.totaalKosten.volledigheid.status).toBe("ONVOLLEDIG");
  });
});

describe("berekenPnLBoom — Q. één engine voor alle vier waardesoorten", () => {
  it("dezelfde functie, aangeroepen met een andere waardesoort, levert een correct getagd resultaat op zonder de rekenlogica te wijzigen", () => {
    const regels: PurePnLBronRegel[] = [
      { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(100000)) },
      { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(30000)) },
    ];
    const begroting = berekenPnLBoom("BEGROTING_VORIG_JAAR", regels);
    const werkelijk = berekenPnLBoom("WERKELIJK", regels);
    const estimated = berekenPnLBoom("ESTIMATED", regels);
    const nieuweBegroting = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);

    for (const resultaat of [begroting, werkelijk, estimated, nieuweBegroting]) {
      expect(resultaat.ebitda.bedrag.toString()).toBe("70000");
    }
    expect(begroting.waardesoort).toBe("BEGROTING_VORIG_JAAR");
    expect(werkelijk.waardesoort).toBe("WERKELIJK");
    expect(estimated.waardesoort).toBe("ESTIMATED");
    expect(nieuweBegroting.waardesoort).toBe("BEGROTING_NIEUW_JAAR");

    const vergelijking = vergelijkPnLResultaten(begroting, werkelijk);
    expect(vergelijking.ebitda.afwijking.toString()).toBe("0");
    expect(vergelijking.waardesoortBasis).toBe("BEGROTING_VORIG_JAAR");
    expect(vergelijking.waardesoortVergelijk).toBe("WERKELIJK");
  });

  it("vergelijkPnLResultaten herberekent niets — een afwijking tussen twee waardesoorten komt exact overeen met het verschil van hun reeds berekende EBITDA's", () => {
    const regelsBasis: PurePnLBronRegel[] = [{ regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(100000)) }];
    const regelsVergelijk: PurePnLBronRegel[] = [{ regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(110000)) }];

    const basis = berekenPnLBoom("ESTIMATED", regelsBasis);
    const vergelijk = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regelsVergelijk);
    const vergelijking = vergelijkPnLResultaten(basis, vergelijk);

    expect(vergelijking.ebitda.afwijking.toString()).toBe(vergelijk.ebitda.bedrag.minus(basis.ebitda.bedrag).toString());
    expect(vergelijking.totaalOpbrengsten.afwijking.toString()).toBe("10000");
  });
});

describe("berekenPnLBoom — R. tekennormalisatie: kosten/opbrengsten/korting/correcties, geen dubbele tekenomkering", () => {
  it("een positief KOSTEN-bedrag verhoogt Totaal kosten, een negatieve correctie op diezelfde groep verlaagt het weer", () => {
    const kosten: PurePnLBronRegel = { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(30000)) };
    const correctie: PurePnLBronRegel = { regelSleutel: "ONDERHOUD_CORRECTIE_VORIG_JAAR", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(-2000)) };
    const resultaat = berekenPnLBoom("WERKELIJK", [kosten, correctie]);
    expect(resultaat.totaalKosten.besteWetenSom.toString()).toBe("28000");
  });

  it("een positief OPBRENGST-bedrag verhoogt Totaal opbrengsten, huurkorting (negatief, zelfde aard) verlaagt het weer — exact test B herhaald als tekenbewijs", () => {
    const resultaat = berekenPnLBoom("WERKELIJK", huurRegels());
    expect(resultaat.totaalOpbrengsten.besteWetenSom.toString()).toBe("247000");
  });

  it("de engine draait zelf nooit een teken om: een reeds-genormaliseerd (adapter-genegeerd) Rente-opbrengstenbedrag wordt ongewijzigd gesommeerd, geen dubbele omkering", () => {
    const RENTE_013 = berekenWerkelijkRente(
      [
        { ogbKostensoort: "4604", saldo: new Decimal("-1215.67") },
        { ogbKostensoort: "4621", saldo: new Decimal("-34.42") },
      ],
      [
        { ogbKostensoort: "4604", ogbKostensoortOmschrijving: "Rente r/c", categorie: "RENTE_OPBRENGSTEN" },
        { ogbKostensoort: "4621", ogbKostensoortOmschrijving: "Rente opbrengst telerek", categorie: "RENTE_OPBRENGSTEN" },
      ],
    );
    // Ruw CAL-FIN-001-saldo is -1250.09; de adapter negeert dit ÉÉN keer naar +1250.09.
    const [, renteOpbrengstenRegel] = renteOnderEbitdaRegels(RENTE_013, true);
    expect((renteOpbrengstenRegel!.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("1250.09");

    // Zou de engine dit bedrag zelf NOG EEN KEER omkeren (heuristisch, op basis van contributieAard
    // "OPBRENGST"), dan zou onderEbitda het genegeerde bedrag (-1250.09) bevatten. Dat gebeurt niet:
    // de engine geeft het bedrag exact door zoals aangeleverd.
    const resultaat = berekenPnLBoom("WERKELIJK", [renteOpbrengstenRegel!]);
    const teruggegeven = resultaat.onderEbitda.find((r) => r.regelSleutel === "RENTE_OPBRENGSTEN")!;
    expect((teruggegeven.waarde as { status: "BEKEND"; bedrag: Decimal }).bedrag.toString()).toBe("1250.09");
  });

  it("fail-fast: een OPBRENGSTEN-groepregel met contributieAard KOSTEN is een adapterfout, geen stille correctie", () => {
    const kapotteRegel: PurePnLBronRegel = { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "KOSTEN", waarde: bekend(new Decimal(1000)) };
    expect(() => berekenPnLBoom("WERKELIJK", [kapotteRegel])).toThrow(/contributieAard "KOSTEN", verwacht "OPBRENGST"/);
  });

  it("fail-fast: een EXPLOITATIE_LASTEN-groepregel met contributieAard OPBRENGST is een adapterfout", () => {
    const kapotteRegel: PurePnLBronRegel = { regelSleutel: "ONDERHOUD", boomPositie: "BOVEN_EBITDA", groep: "EXPLOITATIE_LASTEN", contributieAard: "OPBRENGST", waarde: bekend(new Decimal(1000)) };
    expect(() => berekenPnLBoom("WERKELIJK", [kapotteRegel])).toThrow(/contributieAard "OPBRENGST", verwacht "KOSTEN"/);
  });
});

describe("berekenPnLBoom — integratie: Leegstand + Verzekeringen (boven EBITDA) + Rente (onder EBITDA) via echte bewijs-adapters", () => {
  it("de bewezen bronproeven 070/GL4350 (Leegstand, €1.354,10) en GL4130/OGB4131 (Verzekeringen, testfixture €2.140,75) tellen boven EBITDA mee; Rente (023, €1.148.524,51) blijft eronder", () => {
    const leegstandBoekingen: WerkelijkLeegstandBoekingRegel[] = [
      { ogbKostensoort: "4319", complexnummer: "003", saldo: new Decimal("1354.1") },
    ];
    const leegstandResultaat = berekenWerkelijkLeegstand(leegstandBoekingen, [{ ogbKostensoort: "4319", ogbKostensoortOmschrijving: "Servicekosten leegstand", categorie: "SERVICEKOSTEN_LEEGSTAND" }]);

    const verzekeringBoekingen: WerkelijkVerzekeringBoekingRegel[] = [{ economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: "003", saldo: new Decimal("2140.75") }];
    const verzekeringResultaat = berekenWerkelijkVerzekeringen(verzekeringBoekingen);

    const RENTE_023 = berekenWerkelijkRente(
      [{ ogbKostensoort: "4601", saldo: new Decimal("1148524.51") }],
      [{ ogbKostensoort: "4601", ogbKostensoortOmschrijving: "Rente lening .962", categorie: "RENTEKOSTEN" }],
    );

    const regels: PurePnLBronRegel[] = [
      ...huurRegels(),
      leegstandBovenEbitdaRegel(leegstandResultaat),
      verzekeringenBovenEbitdaRegel(verzekeringResultaat),
      ...renteOnderEbitdaRegels(RENTE_023, true),
    ];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);

    expect(resultaat.exploitatieLasten.besteWetenSom.toString()).toBe("3494.85"); // 1354.10 + 2140.75
    expect(resultaat.totaalOpbrengsten.besteWetenSom.toString()).toBe("247000");
    expect(resultaat.ebitda.bedrag.toString()).toBe("243505.15"); // 247000 - 3494.85
    expect(resultaat.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
    expect(resultaat.onderEbitda.map((r) => r.regelSleutel).sort()).toEqual(["RENTEKOSTEN", "RENTE_OPBRENGSTEN"]);
    // Rentekosten (€1.148.524,51) zit structureel NIET in exploitatieLasten/totaalKosten/ebitda — de
    // scheiding boven/onder EBITDA is hier het kernbewijs (zie moduledoc §9).
    expect(resultaat.totaalKosten.besteWetenSom.toString()).not.toContain("1148524");
  });
});
