import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, kasstroomCategorieVoorRegel, liquideMiddelenVoorRegel, zoekMappingRegel, type Balansstand, type Boekingsregel } from "@bvc/domain";
import { berekenKasstroomPeriode } from "./kasstroomBerekening.js";

/**
 * Kasstroom-managementoverzicht (2026-08-24, vereenvoudigd op expliciet
 * verzoek van de gebruiker — "hoeveel geld kwam er binnen, hoeveel ging
 * eruit, en hoeveel daarvan heb ik zelf opgenomen?"). Bouwt voort op de
 * bewezen `berekenKasstroomPeriode` (bankstand begin/eind/netto,
 * ONGEWIJZIGD hergebruikt, geen dubbele berekening) en leidt ontvangsten/
 * uitgaven UITSLUITEND af uit de werkelijke mutaties op de bevestigde
 * liquide-middelen-rekening(en) zelf — geen tegenrekening-classificatie
 * meer nodig voor het totaal. Eigenaaronttrekkingen is een aanvullende
 * uitsplitsing BINNEN de uitgaven (welk deel van de uitgaven ging naar een
 * rekening met `kasstroomCategorie: "EIGENAARONTTREKKING"`, bv. 0840 bij
 * 070) — niet een aparte, los berekende categorie.
 *
 * Twee aansluitingen gelden ALTIJD, structureel (nooit een aparte
 * controle nodig, ze volgen uit de constructie van deze functie):
 * - `ontvangsten - uitgaven = nettoKasstroom` (nettoKasstroom komt
 *   rechtstreeks van `berekenKasstroomPeriode`'s `mutatieTotaal`, en
 *   ontvangsten/uitgaven zijn respectievelijk de som van de positieve en
 *   de (als positief bedrag getoonde) negatieve boekingen op dezelfde
 *   liquide-middelen-rekeningen — wiskundig per definitie gelijk).
 * - `eigenaarOnttrekkingen + overigeUitgaven = uitgaven` (`overigeUitgaven`
 *   is expliciet gedefinieerd als het restbedrag, geen apart berekende/
 *   te bevestigen categorie).
 *
 * Ontvangsten/uitgaven-splitsing: per individuele boeking op een liquide-
 * middelen-rekening (debet-credit positief = ontvangst, negatief =
 * uitgave) — geen boekstuk-/tegenrekeninglogica nodig voor dit totaal.
 *
 * Eigenaaronttrekkingen-splitsing: hergebruikt het boekstukSleutel-
 * mechanisme (CAL-FIN-006/`boekstukcontrole`) alleen om, per UITGAVE-
 * boekstuk, te bepalen of de tegenrekening(en) allemaal een bevestigde
 * `kasstroomCategorie: "EIGENAARONTTREKKING"` hebben. Zijn ze dat niet
 * (onbekend, ongemapt, of een andere/geen classificatie), dan telt het
 * bedrag mee in `overigeUitgaven` — dat is de bewuste, gedefinieerde
 * restcategorie, GEEN gok (CLAUDE.md §6): "overig" hoeft niet apart
 * bevestigd te worden, het is per definitie "niet aantoonbaar een
 * eigenaaronttrekking". Alleen een boekstuk met tegenrekeningen die
 * GEDEELTELIJK (niet allemaal) op eigenaaronttrekking wijzen is echt
 * ambigu voor deze ene sub-splitsing — dat komt als informatieve regel in
 * `controleVereist` (telt wél gewoon mee in `overigeUitgaven`, nooit
 * verloren of dubbel geteld).
 */

export interface KasstroomKwartaalRegel {
  kwartaal: 1 | 2 | 3 | 4;
  ontvangsten: Decimal;
  uitgaven: Decimal;
  eigenaarOnttrekkingen: Decimal;
  nettoKasstroom: Decimal;
}

export interface KasstroomManagementoverzichtControleVereist {
  /** Tegenrekening, of (bij een gemengd uitgave-boekstuk) een kommagescheiden lijst van tegenrekeningen. */
  grootboekrekening: string;
  saldo: Decimal;
  reden: string;
}

export interface KasstroomManagementoverzichtResultaat {
  bankstandBegin: Decimal;
  bankstandEind: Decimal;
  ontvangsten: Decimal;
  uitgaven: Decimal;
  /** = ontvangsten - uitgaven (per constructie gelijk aan bankstandEind - bankstandBegin). */
  nettoKasstroom: Decimal;
  /** Uitsplitsing BINNEN uitgaven: bedrag met een bevestigde tegenrekening-kasstroomCategorie "EIGENAARONTTREKKING", als positief bedrag. */
  eigenaarOnttrekkingen: Decimal;
  /** = uitgaven - eigenaarOnttrekkingen (per definitie, geen aparte berekening/aanname). */
  overigeUitgaven: Decimal;
  perKwartaal: KasstroomKwartaalRegel[];
  controleVereist: KasstroomManagementoverzichtControleVereist[];
}

interface BoekstukInfo {
  liquideBedrag: Decimal;
  liquideBoekdatum: Date;
  tegenRegels: Boekingsregel[];
}

export function berekenKasstroomManagementoverzicht(
  balansstanden: readonly Balansstand[],
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
): KasstroomManagementoverzichtResultaat {
  const kasstroomPeriode = berekenKasstroomPeriode(balansstanden, boekingen, mappingRegels);

  const liquideRekeningen = new Set<string>();
  for (const regel of mappingRegels) {
    if (regel.soort !== "BALANS") continue;
    const liquideResultaat = liquideMiddelenVoorRegel(regel);
    if (liquideResultaat.type === "bekend" && liquideResultaat.waarde) liquideRekeningen.add(regel.grootboekrekening);
  }

  // Ontvangsten/uitgaven: rechtstreeks per boeking op een liquide-middelen-rekening, geen
  // tegenrekeninglogica nodig — zie moduledoc.
  let ontvangsten = new Decimal(0);
  let uitgaven = new Decimal(0);
  const perKwartaalOntvangsten = new Map<number, Decimal>();
  const perKwartaalUitgaven = new Map<number, Decimal>();

  for (const boeking of boekingen) {
    if (!liquideRekeningen.has(boeking.grootboeknr)) continue;
    const saldo = boekingSaldo(boeking);
    const kwartaal = kwartaalVanDatum(boeking.boekdatum);
    if (saldo.isPositive()) {
      ontvangsten = ontvangsten.plus(saldo);
      perKwartaalOntvangsten.set(kwartaal, (perKwartaalOntvangsten.get(kwartaal) ?? new Decimal(0)).plus(saldo));
    } else if (saldo.isNegative()) {
      uitgaven = uitgaven.plus(saldo.negated());
      perKwartaalUitgaven.set(kwartaal, (perKwartaalUitgaven.get(kwartaal) ?? new Decimal(0)).plus(saldo.negated()));
    }
  }

  // Eigenaaronttrekkingen: alleen voor UITGAVE-boekstukken, via de tegenrekening(en) van dat boekstuk.
  const boekstukkenPerSleutel = new Map<string, BoekstukInfo>();
  for (const boeking of boekingen) {
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    const isLiquide = liquideRekeningen.has(boeking.grootboeknr);
    const bestaand = boekstukkenPerSleutel.get(key);
    if (bestaand) {
      if (isLiquide) {
        bestaand.liquideBedrag = bestaand.liquideBedrag.plus(boekingSaldo(boeking));
      } else {
        bestaand.tegenRegels.push(boeking);
      }
    } else {
      boekstukkenPerSleutel.set(key, {
        liquideBedrag: isLiquide ? boekingSaldo(boeking) : new Decimal(0),
        liquideBoekdatum: boeking.boekdatum,
        tegenRegels: isLiquide ? [] : [boeking],
      });
    }
  }

  let eigenaarOnttrekkingen = new Decimal(0);
  const perKwartaalOnttrekkingen = new Map<number, Decimal>();
  const controleAccumulator = new Map<string, { saldo: Decimal; redenen: Set<string> }>();

  for (const { liquideBedrag, liquideBoekdatum, tegenRegels } of boekstukkenPerSleutel.values()) {
    if (!liquideBedrag.isNegative() || tegenRegels.length === 0) continue; // alleen uitgave-boekstukken met een tegenrekening

    const isOnttrekking = tegenRegels.map((tegenRegel) => {
      const mappingResultaat = zoekMappingRegel(mappingRegels, tegenRegel.grootboeknr);
      if (mappingResultaat.type === "onbekend") return false;
      const categorieResultaat = kasstroomCategorieVoorRegel(mappingResultaat.waarde);
      return categorieResultaat.type === "bekend" && categorieResultaat.waarde === "EIGENAARONTTREKKING";
    });

    const alleOnttrekking = isOnttrekking.every((v) => v);
    const geenOnttrekking = isOnttrekking.every((v) => !v);
    const uitgaveBedrag = liquideBedrag.negated();

    if (alleOnttrekking) {
      const kwartaal = kwartaalVanDatum(liquideBoekdatum);
      eigenaarOnttrekkingen = eigenaarOnttrekkingen.plus(uitgaveBedrag);
      perKwartaalOnttrekkingen.set(kwartaal, (perKwartaalOnttrekkingen.get(kwartaal) ?? new Decimal(0)).plus(uitgaveBedrag));
    } else if (!geenOnttrekking) {
      // Gedeeltelijk: sommige tegenrekeningen wijzen op een eigenaaronttrekking, andere niet — niet
      // eenduidig te splitsen. Telt (bewust) mee in overigeUitgaven, alleen informatief gemeld.
      const rekening = tegenRegels.map((r) => r.grootboeknr).join(", ");
      const bestaand = controleAccumulator.get(rekening);
      const reden = "Boekstuk heeft tegenrekeningen die gedeeltelijk op een eigenaaronttrekking wijzen — niet eenduidig te splitsen, telt mee in overigeUitgaven.";
      if (bestaand) {
        bestaand.saldo = bestaand.saldo.plus(uitgaveBedrag);
        bestaand.redenen.add(reden);
      } else {
        controleAccumulator.set(rekening, { saldo: uitgaveBedrag, redenen: new Set([reden]) });
      }
    }
  }

  const overigeUitgaven = uitgaven.minus(eigenaarOnttrekkingen);

  const perKwartaal: KasstroomKwartaalRegel[] = ([1, 2, 3, 4] as const).map((kwartaal) => {
    const kwOntvangsten = perKwartaalOntvangsten.get(kwartaal) ?? new Decimal(0);
    const kwUitgaven = perKwartaalUitgaven.get(kwartaal) ?? new Decimal(0);
    const kwOnttrekkingen = perKwartaalOnttrekkingen.get(kwartaal) ?? new Decimal(0);
    return { kwartaal, ontvangsten: kwOntvangsten, uitgaven: kwUitgaven, eigenaarOnttrekkingen: kwOnttrekkingen, nettoKasstroom: kwOntvangsten.minus(kwUitgaven) };
  });

  const controleVereist: KasstroomManagementoverzichtControleVereist[] = [
    ...kasstroomPeriode.controleVereist,
    ...Array.from(controleAccumulator.entries()).map(([grootboekrekening, entry]) => ({
      grootboekrekening,
      saldo: entry.saldo,
      reden: Array.from(entry.redenen).join(" "),
    })),
  ].sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  return {
    bankstandBegin: kasstroomPeriode.beginstandTotaal,
    bankstandEind: kasstroomPeriode.eindstandTotaal,
    ontvangsten,
    uitgaven,
    nettoKasstroom: kasstroomPeriode.mutatieTotaal,
    eigenaarOnttrekkingen,
    overigeUitgaven,
    perKwartaal,
    controleVereist,
  };
}

function kwartaalVanDatum(datum: Date): 1 | 2 | 3 | 4 {
  return (Math.floor(datum.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
}
