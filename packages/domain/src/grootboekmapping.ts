import type { Balanszijde, BalansRegel, GrootboekMappingRegel, KasstroomCategorie, Tekenconventie } from "@bvc/config";
import type { OnbekendOf } from "./types.js";

/**
 * Zoekt de mappingregel voor een grootboekrekening op. Geeft nooit
 * stilzwijgend een "leeg"/default resultaat: een onbekende rekening of een
 * inactieve regel levert expliciet `onbekend` op (CLAUDE.md §6, "Controle
 * vereist" i.p.v. gokken) — de aanroeper moet dit zichtbaar afhandelen, nooit
 * intern negeren of op 0 laten vallen.
 */
export function zoekMappingRegel(
  regels: readonly GrootboekMappingRegel[],
  grootboekrekening: string,
): OnbekendOf<GrootboekMappingRegel> {
  const regel = regels.find((r) => r.grootboekrekening === grootboekrekening);
  if (!regel) {
    return { type: "onbekend", reden: `Grootboekrekening "${grootboekrekening}" komt niet voor in de grootboekmapping — Controle vereist.` };
  }
  if (!regel.actief) {
    const omschrijving = regel.soort === "RESULTAAT" ? ` (rapportagepost "${regel.rapportagepost}")` : " (BALANS-rekening)";
    return {
      type: "onbekend",
      reden: `Grootboekrekening "${grootboekrekening}" heeft een inactieve mapping${omschrijving} — Controle vereist.`,
    };
  }
  return { type: "bekend", waarde: regel };
}

/**
 * Vertaalt een tekenconventie naar de presentatiefactor (1 of -1) die op
 * een werkelijk berekend saldo (debet - credit) toegepast moet worden.
 * Werkt structureel op elk mappingtype met dit veld — zowel RESULTAAT- als
 * BALANS-regels (BALANS-regels kregen `tekenconventie` als apart,
 * onafhankelijk veld van `balanszijde` — zie `@bvc/config`'s
 * `BalansRegelSchema`). Een nog niet bevestigde tekenconventie (`null`)
 * levert `onbekend` op — nooit stilzwijgend "ZOALS_BRON" (factor 1)
 * aannemen.
 */
export function presentatiefactorVoorRegel(regel: { tekenconventie: Tekenconventie | null }): OnbekendOf<1 | -1> {
  if (regel.tekenconventie === null) {
    return {
      type: "onbekend",
      reden: "Tekenconventie nog niet bevestigd voor deze grootboekrekening — Controle vereist, geen aanname toegestaan.",
    };
  }
  return { type: "bekend", waarde: regel.tekenconventie === "ZOALS_BRON" ? 1 : -1 };
}

/**
 * Vertaalt de balanszijde van een BALANS-mappingregel naar `OnbekendOf`.
 * Een nog niet bevestigde balanszijde (`null`) levert `onbekend` op — nooit
 * stilzwijgend op het actuele saldoteken terugvallen (dat zou de balanszijde
 * weer impliciet uit het saldo afleiden, precies wat dit veld voorkomt).
 * Niet van toepassing op RESULTAAT-regels (die hebben geen balanszijde).
 */
export function balanszijdeVoorRegel(regel: Pick<BalansRegel, "balanszijde">): OnbekendOf<Balanszijde> {
  if (regel.balanszijde === null) {
    return {
      type: "onbekend",
      reden: "Balanszijde (Activa/Passiva) nog niet bevestigd voor deze grootboekrekening — Controle vereist, geen aanname op basis van het saldoteken toegestaan.",
    };
  }
  return { type: "bekend", waarde: regel.balanszijde };
}

/**
 * Vertaalt `liquideMiddelen` van een BALANS-mappingregel naar `OnbekendOf`
 * — zelfde nullable-patroon als `balanszijdeVoorRegel`/
 * `presentatiefactorVoorRegel`. Een nog niet bevestigde classificatie
 * (`null`) levert `onbekend` op — nooit stilzwijgend "geen liquide
 * middelen" aannemen (zie `@bvc/config`'s `BalansRegelSchema`).
 */
export function liquideMiddelenVoorRegel(regel: Pick<BalansRegel, "liquideMiddelen">): OnbekendOf<boolean> {
  if (regel.liquideMiddelen === null) {
    return {
      type: "onbekend",
      reden: "Liquiditeitsclassificatie (liquide middelen ja/nee) nog niet bevestigd voor deze grootboekrekening — Controle vereist, geen aanname toegestaan.",
    };
  }
  return { type: "bekend", waarde: regel.liquideMiddelen };
}

/**
 * Vertaalt `kasstroomCategorie` van een mappingregel naar `OnbekendOf` —
 * zelfde nullable-patroon als `liquideMiddelenVoorRegel`. Werkt structureel
 * op elk mappingtype met dit veld (zowel BALANS- als RESULTAAT-regels, zie
 * `@bvc/config`'s `KasstroomCategorieSchema`-moduledoc: de tegenrekening
 * van een liquide-middelen-mutatie kan van beide soorten zijn). Een nog
 * niet bevestigde classificatie (`null`) levert `onbekend` op — nooit
 * stilzwijgend aangenomen.
 */
export function kasstroomCategorieVoorRegel(regel: { kasstroomCategorie: KasstroomCategorie | null }): OnbekendOf<KasstroomCategorie> {
  if (regel.kasstroomCategorie === null) {
    return {
      type: "onbekend",
      reden: "Kasstroomcategorie (huurontvangst/exploitatie-uitgave/eigenaaronttrekking/overig) nog niet bevestigd voor deze grootboekrekening — Controle vereist, geen aanname toegestaan.",
    };
  }
  return { type: "bekend", waarde: regel.kasstroomCategorie };
}

/**
 * Herkomst van een classificatie/presentatiekeuze (balanszijde, tekenconventie)
 * voor één grootboekrekening — voorbereiding op de toekomstige interactieve
 * balansrapportage (nog niet gebouwd, zie packages/reporting/README.md):
 * een gebruiker moet later per post kunnen zien/kiezen of een waarde uit de
 * centrale master komt, uit de administratie-eigen override, uit een
 * toekomstige per-rapport correctie, of nergens uit (nog onbekend).
 * `RAPPORT_OVERRIDE` bestaat nu nog niet als opslagmechanisme — die waarde
 * is alvast in de type-unie opgenomen zodat de rekenlaag er later op kan
 * uitbreiden zonder een breaking change.
 */
export type MappingHerkomst = "MASTER" | "ADMINISTRATIE_OVERRIDE" | "RAPPORT_OVERRIDE" | "ONBEKEND";

/**
 * Bepaalt de herkomst van de mapping-regel voor één grootboekrekening: wint
 * de override (`ADMINISTRATIE_OVERRIDE`), staat hij alleen in de master
 * (`MASTER`), of komt hij nergens voor (`ONBEKEND`). Zelfde
 * winstprioriteit als `resolveerGrootboekMapping` — bewust een aparte,
 * kleine functie in plaats van die functie te laten muteren, zodat
 * bestaande aanroepers (bv. `berekenPlPeriode`) ongewijzigd blijven werken
 * met de platte, samengevoegde regelset.
 */
export function herkomstVoorRekening(
  master: readonly GrootboekMappingRegel[],
  override: readonly GrootboekMappingRegel[],
  grootboekrekening: string,
): MappingHerkomst {
  if (override.some((regel) => regel.grootboekrekening === grootboekrekening)) return "ADMINISTRATIE_OVERRIDE";
  if (master.some((regel) => regel.grootboekrekening === grootboekrekening)) return "MASTER";
  return "ONBEKEND";
}

/**
 * Combineert de centrale master-grootboekmapping met een administratie-
 * eigen override tot één effectieve regelset: per grootboekrekening wint
 * de override-regel als die bestaat, anders geldt de master-regel. Een
 * override mag dus partieel zijn ("alleen wat afwijkt van de master") —
 * dat is precies het doel van deze functie. Geen validatie hier (dubbele
 * grootboekrekeningen binnen master/override zijn al uitgesloten door
 * `parseGrootboekMapping`/`parseGrootboekMappingMaster`); het resultaat
 * kan dus per constructie nooit een dubbele grootboekrekening bevatten.
 */
export function resolveerGrootboekMapping(
  master: readonly GrootboekMappingRegel[],
  override: readonly GrootboekMappingRegel[],
): GrootboekMappingRegel[] {
  const overrideRekeningen = new Set(override.map((regel) => regel.grootboekrekening));
  const masterZonderOverrides = master.filter((regel) => !overrideRekeningen.has(regel.grootboekrekening));
  return [...masterZonderOverrides, ...override];
}
