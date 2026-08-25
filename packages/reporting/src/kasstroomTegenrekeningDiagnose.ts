import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, kasstroomCategorieVoorRegel, liquideMiddelenVoorRegel, zoekMappingRegel, type Boekingsregel } from "@bvc/domain";

/**
 * Alleen-lezen diagnostiek (2026-08-25) — geen rapport, geen KPI, verandert
 * niets aan `berekenKasstroomManagementoverzicht`. Doel: per boekstuk waarin
 * een opgegeven grootboekrekening voorkomt, tonen of dat boekstuk vandaag
 * meetelt in de eigenaaronttrekkingen-uitsplitsing, en zo niet, waarom niet
 * — zodat een niet-verklaarbaar verschil (bv. "0840 zou €253.000 aan
 * mutaties moeten hebben, het overzicht toont €0,00") met echte productiedata
 * te herleiden is tot een concrete regel/boekstuk, in plaats van gokken.
 *
 * Herhaalt bewust dezelfde boekstuk-groeperings- en classificatielogica als
 * `berekenKasstroomManagementoverzicht` (boekstukSleutel, liquideMiddelen,
 * kasstroomCategorie) — dit bestand introduceert geen nieuwe classificaties
 * of aannames, het legt alleen bloot wat de bestaande logica doet.
 */

export interface KasstroomTegenrekeningDiagnoseRegel {
  grootboeknr: string;
  bedrag: Decimal;
  isLiquide: boolean;
}

export interface KasstroomTegenrekeningDiagnoseBoekstuk {
  boekstukSleutel: string;
  boekdatum: Date;
  liquideBedrag: Decimal;
  bedragVoorDoelrekening: Decimal;
  teltNuMeeAlsEigenaarOnttrekking: boolean;
  redenNietMeegeteld: string | null;
  regels: KasstroomTegenrekeningDiagnoseRegel[];
}

export interface KasstroomTegenrekeningDiagnoseResultaat {
  doelRekening: string;
  /** Als dit `true` is, wordt de doelrekening zelf als bank/kas behandeld en dus NOOIT als tegenrekening bekeken — vaak de oorzaak als dit onverwacht is. */
  doelRekeningIsAlsLiquideGeclassificeerd: boolean;
  doelRekeningMappingGevonden: boolean;
  doelRekeningActief: boolean | null;
  doelRekeningKasstroomCategorie: string | null;
  boekstukken: KasstroomTegenrekeningDiagnoseBoekstuk[];
  totaalBedragMeegeteld: Decimal;
  totaalBedragNietMeegeteld: Decimal;
}

export function diagnoseerKasstroomTegenrekening(
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
  doelRekening: string,
): KasstroomTegenrekeningDiagnoseResultaat {
  const liquideRekeningen = new Set<string>();
  for (const regel of mappingRegels) {
    if (regel.soort !== "BALANS") continue;
    const liquideResultaat = liquideMiddelenVoorRegel(regel);
    if (liquideResultaat.type === "bekend" && liquideResultaat.waarde) liquideRekeningen.add(regel.grootboekrekening);
  }

  const doelMappingResultaat = zoekMappingRegel(mappingRegels, doelRekening);
  const doelKasstroomCategorieResultaat = doelMappingResultaat.type === "bekend" ? kasstroomCategorieVoorRegel(doelMappingResultaat.waarde) : null;

  interface Groep {
    boekstukSleutel: string;
    boekdatum: Date;
    regels: Boekingsregel[];
  }
  const groepen = new Map<string, Groep>();
  for (const boeking of boekingen) {
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    const bestaand = groepen.get(key);
    if (bestaand) bestaand.regels.push(boeking);
    else groepen.set(key, { boekstukSleutel: boeking.boekstukSleutel, boekdatum: boeking.boekdatum, regels: [boeking] });
  }

  const boekstukken: KasstroomTegenrekeningDiagnoseBoekstuk[] = [];
  let totaalMeegeteld = new Decimal(0);
  let totaalNietMeegeteld = new Decimal(0);

  for (const groep of groepen.values()) {
    if (!groep.regels.some((r) => r.grootboeknr === doelRekening)) continue;

    const liquideRegels = groep.regels.filter((r) => liquideRekeningen.has(r.grootboeknr));
    const tegenRegels = groep.regels.filter((r) => !liquideRekeningen.has(r.grootboeknr));
    const liquideBedrag = liquideRegels.reduce((som, r) => som.plus(boekingSaldo(r)), new Decimal(0));

    let telt = false;
    let redenNiet: string | null;

    if (liquideRegels.length === 0) {
      redenNiet = "Geen enkele regel in dit boekstuk staat op een bevestigde liquide-middelen-rekening.";
    } else if (!liquideBedrag.isNegative()) {
      redenNiet = `Liquide-bedrag van dit boekstuk is niet negatief (${liquideBedrag.toString()}) — telt daarom niet als uitgave.`;
    } else {
      const isOnttrekking = tegenRegels.map((r) => {
        const m = zoekMappingRegel(mappingRegels, r.grootboeknr);
        if (m.type === "onbekend") return false;
        const c = kasstroomCategorieVoorRegel(m.waarde);
        return c.type === "bekend" && c.waarde === "EIGENAARONTTREKKING";
      });
      const alle = isOnttrekking.length > 0 && isOnttrekking.every((v) => v);
      const geen = isOnttrekking.every((v) => !v);
      if (alle) {
        telt = true;
        redenNiet = null;
      } else if (geen) {
        redenNiet = "Geen van de tegenrekeningen in dit boekstuk resolveert naar EIGENAARONTTREKKING (onbekend, ongemapt, of een andere classificatie).";
      } else {
        redenNiet = "Boekstuk heeft een mix van tegenrekeningen — sommige wel, sommige niet EIGENAARONTTREKKING (telt mee in overigeUitgaven, niet in eigenaarOnttrekkingen).";
      }
    }

    const bedragVoorDoel = groep.regels.filter((r) => r.grootboeknr === doelRekening).reduce((som, r) => som.plus(boekingSaldo(r)), new Decimal(0));
    if (telt) totaalMeegeteld = totaalMeegeteld.plus(bedragVoorDoel.abs());
    else totaalNietMeegeteld = totaalNietMeegeteld.plus(bedragVoorDoel.abs());

    boekstukken.push({
      boekstukSleutel: groep.boekstukSleutel,
      boekdatum: groep.boekdatum,
      liquideBedrag,
      bedragVoorDoelrekening: bedragVoorDoel,
      teltNuMeeAlsEigenaarOnttrekking: telt,
      redenNietMeegeteld: redenNiet,
      regels: groep.regels.map((r) => ({ grootboeknr: r.grootboeknr, bedrag: boekingSaldo(r), isLiquide: liquideRekeningen.has(r.grootboeknr) })),
    });
  }

  boekstukken.sort((a, b) => a.boekdatum.getTime() - b.boekdatum.getTime());

  return {
    doelRekening,
    doelRekeningIsAlsLiquideGeclassificeerd: liquideRekeningen.has(doelRekening),
    doelRekeningMappingGevonden: doelMappingResultaat.type === "bekend",
    doelRekeningActief: doelMappingResultaat.type === "bekend" ? doelMappingResultaat.waarde.actief : null,
    doelRekeningKasstroomCategorie: doelKasstroomCategorieResultaat?.type === "bekend" ? doelKasstroomCategorieResultaat.waarde : null,
    boekstukken,
    totaalBedragMeegeteld: totaalMeegeteld,
    totaalBedragNietMeegeteld: totaalNietMeegeteld,
  };
}
