import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  algemeneKostenBegrotingNaarPnLBovenEbitdaRegels,
  beheerBegrotingNaarPnLBovenEbitdaRegels,
  gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels,
  huurBegrotingNaarPnLBovenEbitdaRegels,
  managementBegrotingNaarPnLBovenEbitdaRegels,
  onderhoudBegrotingNaarPnLBovenEbitdaRegels,
  onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels,
  verzekeringenBegrotingNaarPnLBovenEbitdaRegels,
} from "./begrotingPnLAdapters.js";
import { ALGEMENE_KOSTEN_CATEGORIEEN } from "./begroteAlgemeneKosten.js";
import { berekenPnLBoom } from "../pnlEngine.js";

const D = (n: string | number) => new Decimal(n);
const geen: { ernst: string }[] = [];
const kritiek = [{ ernst: "KRITIEK" }];
const waarde = (regels: ReturnType<typeof huurBegrotingNaarPnLBovenEbitdaRegels>, sleutel: string) => regels.find((r) => r.regelSleutel === sleutel)!.waarde;

describe("Huur (Begroting → P&L)", () => {
  it("netto belast en onbelast als OPBRENGSTEN; geen aparte huurkorting-regel (zit in netto)", () => {
    const regels = huurBegrotingNaarPnLBovenEbitdaRegels({ portefeuilleTotalen: { nettoHuurBelast: D(1000), nettoHuurOnbelast: D(400), nettoHuurOnbekendeBtw: D(0) }, controleVereist: geen });
    expect(regels.map((r) => r.regelSleutel)).toEqual(["HUUROPBRENGST_BELAST", "HUUROPBRENGST_ONBELAST"]);
    expect(regels.every((r) => r.groep === "OPBRENGSTEN" && r.contributieAard === "OPBRENGST")).toBe(true);
    expect(waarde(regels, "HUUROPBRENGST_BELAST")).toEqual({ status: "BEKEND", bedrag: D(1000) });
  });
  it("onbekende BTW-classificatie wordt als ONBEKEND-regel gemeld, niet weggelaten en niet toegewezen; kritieke controle = ONBEKEND", () => {
    const regels = huurBegrotingNaarPnLBovenEbitdaRegels({ portefeuilleTotalen: { nettoHuurBelast: D(1), nettoHuurOnbelast: D(2), nettoHuurOnbekendeBtw: D(50) }, controleVereist: kritiek });
    expect(regels).toHaveLength(3);
    expect(regels.every((r) => r.waarde.status === "ONBEKEND")).toBe(true);
  });
});

describe("Beheer / Management (Begroting → P&L)", () => {
  it("Beheer: totale vergoeding als BEHEERKOSTEN; Management: geen invoer = ONBEKEND (€0 ≠ niet ingevuld), bewust €0 = BEKEND", () => {
    expect(waarde(beheerBegrotingNaarPnLBovenEbitdaRegels({ portefeuilleTotalen: { totaleVergoeding: D(6000) }, controleVereist: geen }), "BEHEERKOSTEN")).toEqual({ status: "BEKEND", bedrag: D(6000) });
    expect(managementBegrotingNaarPnLBovenEbitdaRegels(null)[0]!.waarde.status).toBe("ONBEKEND");
    expect(managementBegrotingNaarPnLBovenEbitdaRegels({ jaartotaal: { bedrag: D(0) }, controleVereist: geen })[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(0) });
  });
});

describe("Onderhoud (Begroting → P&L): totaal = Gepland + Correctief/Dagelijks, exact één keer", () => {
  it("som van beide delen; ONBEKEND zodra een deel niet beoordeeld is of kritiek heeft", () => {
    const ok = onderhoudBegrotingNaarPnLBovenEbitdaRegels({ gepland: { beoordeeld: true, totaalJaar: D(9000), controleVereist: geen }, correctiefDagelijks: { beoordeeld: true, totaalJaar: D(2500), controleVereist: geen } });
    expect(ok).toHaveLength(1);
    expect(ok[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(11500) });
    const nietBeoordeeld = onderhoudBegrotingNaarPnLBovenEbitdaRegels({ gepland: { beoordeeld: true, totaalJaar: D(9000), controleVereist: geen }, correctiefDagelijks: { beoordeeld: false, totaalJaar: D(0), controleVereist: geen } });
    expect(nietBeoordeeld[0]!.waarde.status).toBe("ONBEKEND");
  });
  it("bewust beoordeeld met €0 is een bekende €0", () => {
    const r = onderhoudBegrotingNaarPnLBovenEbitdaRegels({ gepland: { beoordeeld: true, totaalJaar: D(0), controleVereist: geen }, correctiefDagelijks: { beoordeeld: true, totaalJaar: D(0), controleVereist: geen } });
    expect(r[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(0) });
  });
});

describe("Verzekeringen (Begroting → P&L)", () => {
  it("effectief jaarbedrag bij beoordeeld en kritiek-vrij; anders ONBEKEND", () => {
    expect(verzekeringenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, totaalEffectiefBegroot: D(4200), controleVereist: geen })[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(4200) });
    expect(verzekeringenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, totaalEffectiefBegroot: D(4200), controleVereist: kritiek })[0]!.waarde.status).toBe("ONBEKEND");
    expect(verzekeringenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: false, totaalEffectiefBegroot: D(0), controleVereist: geen })[0]!.waarde.status).toBe("ONBEKEND");
  });
});

describe("Gemeentelijke lasten (Begroting → P&L): de GL-regelpost, NIET het WOZ-voorstel", () => {
  it("de adapter neemt uitsluitend grootboekRegels.begroteGemeentelijkeLastenPost — het WOZ-voorstel kan er niet eens in", () => {
    const r = gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, controleVereist: geen, grootboekRegels: { begroteGemeentelijkeLastenPost: D(8200), controleVereist: geen } });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ regelSleutel: "GEMEENTELIJKE_LASTEN", groep: "EXPLOITATIE_LASTEN", contributieAard: "KOSTEN" });
    expect(r[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(8200) });
  });
  it("vóór migratie 33 bevroren (geen GL-regels): ONBEKEND — nooit €0 en nooit het voorstel", () => {
    expect(gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, controleVereist: geen, grootboekRegels: null })[0]!.waarde.status).toBe("ONBEKEND");
  });
  it("onbevestigde WOZ-set (kritiek op module-niveau) of kritieke GL-regel: ONBEKEND; een verschil-waarschuwing blokkeert niet", () => {
    const post = { begroteGemeentelijkeLastenPost: D(100), controleVereist: geen };
    expect(gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, controleVereist: kritiek, grootboekRegels: post })[0]!.waarde.status).toBe("ONBEKEND");
    expect(gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, controleVereist: geen, grootboekRegels: { ...post, controleVereist: kritiek } })[0]!.waarde.status).toBe("ONBEKEND");
    expect(gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, controleVereist: geen, grootboekRegels: { ...post, controleVereist: [{ ernst: "WAARSCHUWING" }] } })[0]!.waarde.status).toBe("BEKEND");
  });
  it("niet beoordeeld: ONBEKEND (geen stille €0)", () => {
    expect(gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: false, controleVereist: geen, grootboekRegels: { begroteGemeentelijkeLastenPost: D(0), controleVereist: geen } })[0]!.waarde.status).toBe("ONBEKEND");
  });
});

describe("Algemene kosten (Begroting → P&L): vijf afzonderlijke posten", () => {
  const perCategorie = ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie, i) => ({ categorie, beoordeeld: true, categorieTotaal: D((i + 1) * 100) }));
  it("vijf regels in de vaste volgorde, elk met haar eigen totaal; onbeoordeeld of kritiek per post = ONBEKEND voor alleen die post", () => {
    const regels = algemeneKostenBegrotingNaarPnLBovenEbitdaRegels({ perCategorie, controleVereist: [] });
    expect(regels.map((r) => r.regelSleutel)).toEqual([...ALGEMENE_KOSTEN_CATEGORIEEN]);
    expect(regels.every((r) => r.groep === "ALGEMENE_KOSTEN" && r.waarde.status === "BEKEND")).toBe(true);
    const gemengd = algemeneKostenBegrotingNaarPnLBovenEbitdaRegels({
      perCategorie: perCategorie.map((c) => (c.categorie === "BANKKOSTEN" ? { ...c, beoordeeld: false } : c)),
      controleVereist: [{ categorie: "JURIDISCHE_KOSTEN", ernst: "KRITIEK" }],
    });
    expect(gemengd.filter((r) => r.waarde.status === "ONBEKEND").map((r) => r.regelSleutel).sort()).toEqual(["BANKKOSTEN", "JURIDISCHE_KOSTEN"]);
  });
  it("bewust beoordeeld met €0 is een bekende €0 (Bank €0 ≠ onbekend)", () => {
    const regels = algemeneKostenBegrotingNaarPnLBovenEbitdaRegels({ perCategorie: perCategorie.map((c) => ({ ...c, categorieTotaal: D(0) })), controleVereist: [] });
    expect(regels.every((r) => r.waarde.status === "BEKEND")).toBe(true);
  });
});

describe("Estimated Onderhoud (totaalniveau → P&L)", () => {
  const basis = { estimatedOnderhoudTotaal: D(15000), werkelijkDekkingBevestigd: true, nietGeclassificeerdTotaal: D(0), activiteitenZonderResterendeVerwachting: 0, regelsZonderResterendeVerwachting: 0 };
  it("BEKEND bij bevestigde dekking, geen niet-geclassificeerde boekingen en een verwachting voor alle onderdelen", () => {
    expect(onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels(basis)[0]!.waarde).toEqual({ status: "BEKEND", bedrag: D(15000) });
  });
  it("onbevestigde Werkelijk-dekking of niet-geclassificeerde boekingen: ONBEKEND/NIET_GEMAPT", () => {
    expect(onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels({ ...basis, werkelijkDekkingBevestigd: false })[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
    expect(onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels({ ...basis, nietGeclassificeerdTotaal: D(12) })[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "NIET_GEMAPT" });
  });
  it("een activiteit of regel zonder vastgelegde resterende verwachting is niet stil €0: ONBEKEND/GEEN_BEOORDELING", () => {
    expect(onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels({ ...basis, activiteitenZonderResterendeVerwachting: 2 })[0]!.waarde).toMatchObject({ status: "ONBEKEND", dekkingReden: "GEEN_BEOORDELING" });
    expect(onderhoudEstimatedTotaalNaarPnLBovenEbitdaRegels({ ...basis, regelsZonderResterendeVerwachting: 1 })[0]!.waarde.status).toBe("ONBEKEND");
  });
});

describe("Samenstelling door de pure P&L-engine: subtotalen blijven afgeleid", () => {
  it("Begroting-regels van alle modules → totaalOpbrengsten, totaalKosten en EBITDA uitsluitend door de engine berekend; Onderhoud telt éénmaal", () => {
    const regels = [
      ...huurBegrotingNaarPnLBovenEbitdaRegels({ portefeuilleTotalen: { nettoHuurBelast: D(1000), nettoHuurOnbelast: D(500), nettoHuurOnbekendeBtw: D(0) }, controleVereist: geen }),
      ...beheerBegrotingNaarPnLBovenEbitdaRegels({ portefeuilleTotalen: { totaleVergoeding: D(100) }, controleVereist: geen }),
      ...managementBegrotingNaarPnLBovenEbitdaRegels({ jaartotaal: { bedrag: D(50) }, controleVereist: geen }),
      ...onderhoudBegrotingNaarPnLBovenEbitdaRegels({ gepland: { beoordeeld: true, totaalJaar: D(200), controleVereist: geen }, correctiefDagelijks: { beoordeeld: true, totaalJaar: D(100), controleVereist: geen } }),
      ...verzekeringenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, totaalEffectiefBegroot: D(60), controleVereist: geen }),
      ...gemeentelijkeLastenBegrotingNaarPnLBovenEbitdaRegels({ beoordeeld: true, controleVereist: geen, grootboekRegels: { begroteGemeentelijkeLastenPost: D(40), controleVereist: geen } }),
      ...algemeneKostenBegrotingNaarPnLBovenEbitdaRegels({ perCategorie: ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => ({ categorie, beoordeeld: true, categorieTotaal: D(10) })), controleVereist: [] }),
    ];
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);
    expect(boom.totaalOpbrengsten.besteWetenSom.toString()).toBe("1500");
    expect(boom.managementEnBeheer.besteWetenSom.toString()).toBe("150");
    expect(boom.exploitatieLasten.besteWetenSom.toString()).toBe("400"); // 300 onderhoud + 60 verzekeringen + 40 gemeentelijke lasten
    expect(boom.algemeneKosten.besteWetenSom.toString()).toBe("50");
    expect(boom.totaalKosten.besteWetenSom.toString()).toBe("600");
    expect(boom.ebitda.bedrag.toString()).toBe("900");
    expect(boom.ebitda.volledigheid).toEqual({ status: "VOLLEDIG" });
  });
  it("één onbekende post maakt EBITDA ONVOLLEDIG, zonder dat het bedrag als €0 wordt meegeteld", () => {
    const regels = [
      ...managementBegrotingNaarPnLBovenEbitdaRegels(null),
      ...beheerBegrotingNaarPnLBovenEbitdaRegels({ portefeuilleTotalen: { totaleVergoeding: D(100) }, controleVereist: geen }),
    ];
    const boom = berekenPnLBoom("BEGROTING_NIEUW_JAAR", regels);
    expect(boom.managementEnBeheer.besteWetenSom.toString()).toBe("100");
    expect(boom.managementEnBeheer.volledigheid.status).toBe("ONVOLLEDIG");
    expect(boom.ebitda.volledigheid.status).toBe("ONVOLLEDIG");
  });
});
