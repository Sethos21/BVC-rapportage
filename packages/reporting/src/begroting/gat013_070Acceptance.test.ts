import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenWerkelijkBeheerViaCentraleMapping, type BeheerRuweBoekingRegel } from "./beheerCentraleMapping.js";
import { beheerWerkelijkNaarPnLBovenEbitdaRegels } from "./beheerWerkelijkPnLAdapter.js";
import { berekenWerkelijkOnderhoudViaCentraleMapping, type OnderhoudRuweBoekingRegel } from "./onderhoudCentraleMapping.js";
import { onderhoudWerkelijkNaarPnLBovenEbitdaRegels } from "./onderhoudWerkelijkPnLAdapter.js";
import { berekenWerkelijkVerzekeringenViaCentraleMapping, type VerzekeringRuweBoekingRegel } from "./verzekeringCentraleMapping.js";
import { verzekeringWerkelijkNaarPnLBovenEbitdaRegels } from "./verzekeringWerkelijkPnLAdapter.js";
import { berekenWerkelijkGemeentelijkeLastenViaCentraleMapping, type GemeentelijkeLastenRuweBoekingRegel } from "./gemeentelijkeLastenCentraleMapping.js";
import { gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels } from "./gemeentelijkeLastenWerkelijkPnLAdapter.js";
import { berekenWerkelijkAlgemeneKostenViaCentraleMapping, type AlgemeneKostenRuweBoekingRegel } from "./algemeneKostenCentraleMapping.js";
import { algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels } from "./algemeneKostenWerkelijkPnLAdapter.js";
import { berekenWerkelijkHuurViaCentraleMapping, type HuurRuweBoekingRegel } from "./huurCentraleMapping.js";
import { huurWerkelijkNaarPnLBovenEbitdaRegels } from "./huurWerkelijkPnLAdapter.js";
import { berekenWerkelijkServicekostenEigenaarViaCentraleMapping, type ServicekostenEigenaarRuweBoekingRegel } from "./servicekostenEigenaarCentraleMapping.js";
import { servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels } from "./servicekostenEigenaarWerkelijkPnLAdapter.js";
import { berekenPnLBoom, type PurePnLBronRegel, type PurePnLOnderEbitdaRegel } from "../pnlEngine.js";
import {
  AANGEMAAKT,
  BEDRIJFSNR,
  BOEKJAAR,
  BOEKINGEN_ALGEMENE_KOSTEN,
  BOEKINGEN_BEHEER,
  BOEKINGEN_GEMEENTELIJKE_LASTEN,
  BOEKINGEN_HUURKORTING,
  BOEKINGEN_HUUR_BELAST,
  BOEKINGEN_HUUR_ONBELAST,
  BOEKINGEN_ONDERHOUD,
  BOEKINGEN_SERVICEKOSTEN_EIGENAAR,
  BOEKINGEN_VERZEKERINGEN,
  MAPPING_ALGEMENE_KOSTEN,
  MAPPING_BEHEER,
  MAPPING_GEMEENTELIJKE_LASTEN,
  MAPPING_HUUR,
  MAPPING_ONDERHOUD,
  MAPPING_SERVICEKOSTEN_EIGENAAR,
  MAPPING_VERZEKERINGEN,
  OP_SYSTEEMTIJDSTIP,
  inBereik,
  type RuweRegel,
} from "./gat013_070Fixtures.js";

/**
 * FASE GAT-013 (2026-09-17, vervolg) — ACCEPTATIE BUILD: bewijst met ECHTE
 * boekingen van 070_Rooise_Zoom (2026, uit reeds beschikbare Worker-exports
 * — geen fictieve/legacy bedragen) dat de bestaande productieketen
 * (centrale mapping → Werkelijk-calculators → P&L-adapters → Pure P&L
 * Engine) over meerdere perioden correct end-to-end functioneert, en dat
 * Q1 + Q2 = H1 exact geldt per regel en per subtotaal.
 *
 * VERVOLG: Huur (GL8800/8801/8805, GAT-002B-productieketen) en Servicekosten
 * Eigenaar (GL4350, GAT-006-productieketen) zijn nu WEL bronbewezen (bron:
 * boekingen-huur-zonnestroom-ske-2026-070.json) — beide via hun bestaande,
 * ongewijzigde productie-Werkelijk-P&L-adapter. Zonnestroom (GL8815) heeft
 * in deze bron NUL boekingen — een bevestigde afwezigheid, geen ontbrekend
 * onderzoek — en wordt daarom `NIET_VAN_TOEPASSING` meegegeven, ONDER EBITDA
 * (canon-correctie, zie `pnlEngine.ts`-addendum).
 *
 * GEEN NIEUWE ARCHITECTUUR: alle centrale mapping/calculators/adapters
 * hieronder zijn de BESTAANDE, ongewijzigde productiefuncties. DELTA BUILD
 * (2026-09-17): de eerder test-lokale bewijs-adapters voor Onderhoud/
 * Verzekeringen/Gemeentelijke Lasten zijn vervangen door hun nieuwe, echte
 * productie-Werkelijk-P&L-adapters (`onderhoudWerkelijkPnLAdapter.ts`/
 * `verzekeringWerkelijkPnLAdapter.ts`/`gemeentelijkeLastenWerkelijkPnLAdapter.ts`).
 * Daarbij is ook geconstateerd en gecorrigeerd dat Algemene Kosten hier ten
 * onrechte nog een test-lokale bewijs-adapter gebruikte, terwijl de echte
 * productie-adapter (`algemeneKostenWerkelijkPnLAdapter.ts`, GAT-009) al
 * bestond — deze harness gebruikt nu voor GEEN van de zeven modules meer een
 * test-lokale bewijs-adapter; uitsluitend Zonnestroom (GL8815, structureel
 * NIET_VAN_TOEPASSING, geen module met een productieketen) behoudt zijn
 * bewijsregel.
 */

/**
 * Zonnestroom (GL8815) — CANON-CORRECTIE (GAT-013-vervolg, vastgelegd in
 * `pnlEngine.ts`-addendum): GEEN exploitatie-opbrengst, ONDER EBITDA, als
 * bijzondere opbrengst. Voor 070/2026 (Q1 t/m Q3-partieel) bevat de bron
 * NUL boekingen op GL8815 — een BEVESTIGDE afwezigheid (de brondata is wél
 * bevraagd, GL8815 stond in het opgehaalde bereik), geen ontbrekend
 * onderzoek. Daarom `NIET_VAN_TOEPASSING` (bedrag 0), NOOIT `ONBEKEND` en
 * NOOIT stilzwijgend weggelaten.
 */
function zonnestroomRegelBewijs(): PurePnLOnderEbitdaRegel {
  return { regelSleutel: "ZONNESTROOM", boomPositie: "ONDER_EBITDA", contributieAard: "OPBRENGST", waarde: { status: "NIET_VAN_TOEPASSING", bedrag: new Decimal(0) } };
}

/**
 * DE PARAMETRISEERBARE 070-ACCEPTATIEHARNESS: uitsluitend het aangeleverde
 * periodebereik bepaalt de uitkomst — geen aparte rekenlogica per periode.
 */
function run070Acceptance(vanafPeriode: string, totPeriode: string) {
  const filter = (regels: RuweRegel[]) => regels.filter((r) => inBereik(r.periode, vanafPeriode, totPeriode));
  const invoer = { bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: totPeriode, opSysteemtijdstip: OP_SYSTEEMTIJDSTIP };

  const beheerBoekingen: BeheerRuweBoekingRegel[] = filter(BOEKINGEN_BEHEER).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, saldo: new Decimal(r.saldo) }));
  const onderhoudBoekingen: OnderhoudRuweBoekingRegel[] = filter(BOEKINGEN_ONDERHOUD).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, complexnummer: r.complex, saldo: new Decimal(r.saldo) }));
  const verzekeringBoekingen: VerzekeringRuweBoekingRegel[] = filter(BOEKINGEN_VERZEKERINGEN).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, complexnummer: r.complex, saldo: new Decimal(r.saldo) }));
  const gemLastenBoekingen: GemeentelijkeLastenRuweBoekingRegel[] = filter(BOEKINGEN_GEMEENTELIJKE_LASTEN).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, complexnummer: r.complex, saldo: new Decimal(r.saldo) }));
  const algemeneKostenBoekingen: AlgemeneKostenRuweBoekingRegel[] = filter(BOEKINGEN_ALGEMENE_KOSTEN).map((r) => ({ grootboekrekening: r.gl, ogbKostensoort: r.ogb, ogbKostensoortOmschrijving: r.ogbOms, saldo: new Decimal(r.saldo) }));
  const huurBoekingen: HuurRuweBoekingRegel[] = filter([...BOEKINGEN_HUUR_BELAST, ...BOEKINGEN_HUUR_ONBELAST, ...BOEKINGEN_HUURKORTING]).map((r) => ({
    grootboekrekening: r.gl,
    ogbKostensoort: r.ogb,
    ogbKostensoortOmschrijving: r.ogbOms,
    saldo: new Decimal(r.saldo),
  }));
  const skeBoekingen: ServicekostenEigenaarRuweBoekingRegel[] = filter(BOEKINGEN_SERVICEKOSTEN_EIGENAAR).map((r) => ({
    grootboekrekening: r.gl,
    ogbKostensoort: r.ogb,
    ogbKostensoortOmschrijving: r.ogbOms,
    complexnummer: r.complex,
    saldo: new Decimal(r.saldo),
  }));

  const beheer = berekenWerkelijkBeheerViaCentraleMapping(invoer, beheerBoekingen, MAPPING_BEHEER);
  const onderhoud = berekenWerkelijkOnderhoudViaCentraleMapping(invoer, onderhoudBoekingen, MAPPING_ONDERHOUD);
  const verzekering = berekenWerkelijkVerzekeringenViaCentraleMapping(invoer, verzekeringBoekingen, MAPPING_VERZEKERINGEN);
  const gemLasten = berekenWerkelijkGemeentelijkeLastenViaCentraleMapping(invoer, gemLastenBoekingen, MAPPING_GEMEENTELIJKE_LASTEN);
  const algemeneKosten = berekenWerkelijkAlgemeneKostenViaCentraleMapping(invoer, algemeneKostenBoekingen, MAPPING_ALGEMENE_KOSTEN);
  const huur = berekenWerkelijkHuurViaCentraleMapping(invoer, huurBoekingen, MAPPING_HUUR);
  const ske = berekenWerkelijkServicekostenEigenaarViaCentraleMapping(invoer, skeBoekingen, MAPPING_SERVICEKOSTEN_EIGENAAR);

  const regels: PurePnLBronRegel[] = [
    ...huurWerkelijkNaarPnLBovenEbitdaRegels(huur.werkelijk, true),
    ...beheerWerkelijkNaarPnLBovenEbitdaRegels(beheer.werkelijk, true),
    ...onderhoudWerkelijkNaarPnLBovenEbitdaRegels(onderhoud.werkelijk, true),
    ...verzekeringWerkelijkNaarPnLBovenEbitdaRegels(verzekering.werkelijk, true),
    ...gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels(gemLasten.werkelijk, true),
    ...algemeneKostenWerkelijkNaarPnLBovenEbitdaRegels(algemeneKosten.werkelijk, true),
    ...servicekostenEigenaarWerkelijkNaarPnLBovenEbitdaRegels(ske.werkelijk, true),
    zonnestroomRegelBewijs(),
  ];

  const pnl = berekenPnLBoom("WERKELIJK", regels);

  return {
    pnl,
    nietGemapt: [...beheer.nietGemapt, ...onderhoud.nietGemapt, ...verzekering.nietGemapt, ...gemLasten.nietGemapt, ...algemeneKosten.nietGemapt, ...huur.nietGemapt, ...ske.nietGemapt],
    perModule: {
      huurBelast: huur.werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_BELAST")!.categorieTotaal,
      huurOnbelast: huur.werkelijk.perCategorie.find((c) => c.categorie === "HUUROPBRENGST_ONBELAST")!.categorieTotaal,
      huurkorting: huur.werkelijk.perCategorie.find((c) => c.categorie === "VERLEENDE_HUURKORTING")!.categorieTotaal,
      beheer: beheer.werkelijk.moduleTotaal,
      onderhoudGebouwen: onderhoud.werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_GEBOUWEN")!.categorieTotaal,
      onderhoudTerrein: onderhoud.werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_TERREIN")!.categorieTotaal,
      onderhoudInstallaties: onderhoud.werkelijk.perCategorie.find((c) => c.categorie === "ONDERHOUD_INSTALLATIES")!.categorieTotaal,
      verzekeringen: verzekering.werkelijk.moduleTotaal,
      ozbWoz: gemLasten.werkelijk.perCategorie[0]!.categorieTotaal, // GEMEENTELIJKE_LASTEN is één categorie (OB-033) — GL4700+GL4710 samen
      algemeneKosten: algemeneKosten.werkelijk.moduleTotaal,
      servicekostenEigenaar: ske.werkelijk.moduleTotaal,
    },
  };
}

describe("GAT-013 — 070 Rooise Zoom multi-periode acceptatie (volledige P&L, echte 2026-boekingen)", () => {
  const q1 = run070Acceptance("01", "03");
  const q2 = run070Acceptance("04", "06");
  const h1 = run070Acceptance("01", "06");

  it("A. Huur (GAT-002B-keten): Q1/Q2 exact bronbewezen, legacy-match op hele euro's", () => {
    expect(q1.perModule.huurBelast.negated().toString()).toBe("140082.13");
    expect(q1.perModule.huurOnbelast.negated().toString()).toBe("42523.08");
    expect(q1.perModule.huurkorting.toString()).toBe("7086"); // ruw (nog niet genormaliseerd), legacy toont -7.086
    expect(q1.perModule.huurBelast.negated().toDecimalPlaces(0).toString()).toBe("140082"); // legacy 140.082
    expect(q1.perModule.huurOnbelast.negated().toDecimalPlaces(0).toString()).toBe("42523"); // legacy 42.523
    expect(q1.perModule.huurkorting.toDecimalPlaces(0).toString()).toBe("7086"); // legacy -7.086 (voor normalisatie)

    expect(q2.perModule.huurBelast.negated().toDecimalPlaces(0).toString()).toBe("128375"); // legacy 128.375 (exact 128374.52)
    expect(q2.perModule.huurOnbelast.negated().toDecimalPlaces(0).toString()).toBe("42523"); // legacy 42.523
    expect(q2.perModule.huurkorting.toDecimalPlaces(0).toString()).toBe("4682"); // legacy -4.682
  });

  it("B. Servicekosten Eigenaar (GAT-006-keten): Q1 €0, Q2 €199,08, H1 €199,08 — brondata bewijst SERVICEKOSTEN_LEEGSTAND, geen classificatie naar het legacy-bedrag toe", () => {
    expect(q1.perModule.servicekostenEigenaar.toString()).toBe("0");
    expect(q2.perModule.servicekostenEigenaar.toString()).toBe("199.08");
    expect(h1.perModule.servicekostenEigenaar.toString()).toBe("199.08");
    expect(q2.perModule.servicekostenEigenaar.toDecimalPlaces(0).toString()).toBe("199"); // legacy 199
  });

  it("C. Zonnestroom: NIET_VAN_TOEPASSING, onder EBITDA, geen euro-effect (bevestigde afwezigheid GL8815 in de bron)", () => {
    expect(h1.pnl.onderEbitda).toHaveLength(1);
    expect(h1.pnl.onderEbitda[0]!.regelSleutel).toBe("ZONNESTROOM");
    expect(h1.pnl.onderEbitda[0]!.waarde).toEqual({ status: "NIET_VAN_TOEPASSING", bedrag: new Decimal(0) });

    const zonderZonnestroom = berekenPnLBoom("WERKELIJK", [...huurWerkelijkNaarPnLBovenEbitdaRegels((berekenWerkelijkHuurViaCentraleMapping({ bedrijfsnr: BEDRIJFSNR, boekjaar: BOEKJAAR, boekperiode: "06", opSysteemtijdstip: OP_SYSTEEMTIJDSTIP }, [], MAPPING_HUUR)).werkelijk, true)]);
    expect(zonderZonnestroom.onderEbitda).toHaveLength(0); // bewijst dat de regel er alleen staat omdat de harness hem toevoegt, niet dat de engine hem verzint
  });

  it("D. volledige exploitatie-opbrengsten: Q1 exact, Q2 exact, H1 = Q1 + Q2 exact", () => {
    const opbrengstenQ1 = q1.perModule.huurBelast.negated().plus(q1.perModule.huurOnbelast.negated()).plus(q1.perModule.huurkorting.negated());
    const opbrengstenQ2 = q2.perModule.huurBelast.negated().plus(q2.perModule.huurOnbelast.negated()).plus(q2.perModule.huurkorting.negated());
    expect(q1.pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe(opbrengstenQ1.toString());
    expect(q2.pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe(opbrengstenQ2.toString());
    expect(h1.pnl.totaalOpbrengsten.besteWetenSom.toString()).toBe(q1.pnl.totaalOpbrengsten.besteWetenSom.plus(q2.pnl.totaalOpbrengsten.besteWetenSom).toString());
    expect(h1.pnl.totaalOpbrengsten.besteWetenSom.toDecimalPlaces(0).toString()).toBe("341735"); // legacy 341.735
    expect(h1.pnl.totaalOpbrengsten.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("E. volledige exploitatiekosten: H1 = Q1 + Q2 exact, en H1 sluit exact aan op de legacy-referentie (nu incl. Servicekosten Eigenaar)", () => {
    expect(h1.pnl.totaalKosten.besteWetenSom.toString()).toBe(q1.pnl.totaalKosten.besteWetenSom.plus(q2.pnl.totaalKosten.besteWetenSom).toString());
    const somModulesH1 = [h1.perModule.beheer, h1.perModule.onderhoudGebouwen, h1.perModule.onderhoudTerrein, h1.perModule.onderhoudInstallaties, h1.perModule.verzekeringen, h1.perModule.ozbWoz, h1.perModule.algemeneKosten, h1.perModule.servicekostenEigenaar].reduce(
      (t, v) => t.plus(v),
      new Decimal(0),
    );
    expect(h1.pnl.totaalKosten.besteWetenSom.toString()).toBe(somModulesH1.toString());
    expect(h1.pnl.totaalKosten.besteWetenSom.toDecimalPlaces(0).toString()).toBe("30555"); // legacy 30.555, nu volledig verklaard (was 30.356 zonder SKE)
    expect(h1.pnl.totaalKosten.volledigheid).toEqual({ status: "VOLLEDIG" });
  });

  it("F/G. EBITDA: Q1 + Q2 = H1 exact; H1 is een exacte legacy-match, Q1/Q2 wijken elk €1 af door het bekende round-per-regel-vs-sum-dan-afronden-verschil (canon, geen fout)", () => {
    expect(h1.pnl.ebitda.bedrag.toString()).toBe(q1.pnl.ebitda.bedrag.plus(q2.pnl.ebitda.bedrag).toString());
    expect(h1.pnl.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
    // Exact: Q1 151.041,81 (legacy 151.041, rondt legacy-methode-verschil van €1 — zie GAT-013-rapportage);
    // Q2 160.137,85 (legacy 160.139, zelfde €1-verschil, tegengesteld teken); de twee afrondingsverschillen
    // heffen elkaar in H1 exact op.
    expect(q1.pnl.ebitda.bedrag.toString()).toBe("151041.81");
    expect(q2.pnl.ebitda.bedrag.toString()).toBe("160137.85");
    expect(q1.pnl.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("151042"); // legacy 151.041 — €1 afrondingsverschil
    expect(q2.pnl.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("160138"); // legacy 160.139 — €1 afrondingsverschil, tegengesteld
    expect(h1.pnl.ebitda.bedrag.toDecimalPlaces(0).toString()).toBe("311180"); // legacy H1 EBITDA €311.180 — EXACTE match
    expect(new Decimal("151041").plus("160139").toString()).toBe("311180");
  });

  it("gemapte boekingen verdwijnen niet, geen niet-gemapte boekingen in deze bewezen bron", () => {
    expect(q1.nietGemapt).toEqual([]);
    expect(q2.nietGemapt).toEqual([]);
    expect(h1.nietGemapt).toEqual([]);
  });

  it("H1 module-totalen = Q1 + Q2 exact, per module (harde multi-periodecontrole)", () => {
    (Object.keys(q1.perModule) as (keyof typeof q1.perModule)[]).forEach((sleutel) => {
      expect(h1.perModule[sleutel].toString()).toBe(q1.perModule[sleutel].plus(q2.perModule[sleutel]).toString());
    });
  });
});
