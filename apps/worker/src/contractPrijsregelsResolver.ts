import Decimal from "decimal.js";
import type { GestaagdContractPrijsregel } from "@bvc/data-contracts";
import type { BgToekomstigeKortingswijziging } from "@bvc/reporting";

/**
 * TRANCHE 14 — de kandidaat-resolutielaag die `begroteHuuropbrengsten.ts`'s moduledoc (punt 4)
 * expliciet als "aparte, niet-triviale vervolgstap" benoemt: `contract_prijsregels.xlsx` bevat
 * per contract MEERDERE prijsregelrijen (huidige én toekomstige), en deze module herleidt
 * daaruit — uitsluitend deterministisch, NOOIT gokkend — de eenduidige toekomstige VS=13-
 * kortingswijzigingen die de pure Huur-calculator (`berekenBegroteHuuropbrengsten`) verwacht.
 *
 * BEWEZEN BRONFEIT (070, brononderzoek 2026-09): `Status` is voor ALLE 57 rijen van
 * bedrijfsnr 070 uniform "Nieuw" — dit veld discrimineert dus niets tussen een al-verstreken
 * en een toekomstige prijsregel en wordt daarom NOOIT als resolutiecriterium gebruikt (expliciet
 * businessbesluit, zie CLAUDE-opdracht "VOLGENDE DELTA BEGROTINGSMODULE"). Er wordt ook NOOIT
 * simpelweg "de nieuwste rij" gekozen: contract 049 toonde meerdere rijen met DEZELFDE toekomstige
 * `Ingangsdatum_prijsregel` (01-07-2027) maar verschillende `Bedrag_huur`-context (verschillende
 * indexatie-basisjaren) — "nieuwste eerst" zou daar willekeurig één kunnen kiezen.
 *
 * RESOLUTIEREGEL (uitsluitend bewezen-stabiele velden: Bedrijfsnr, Contractnr,
 * Ingangsdatum_prijsregel, Bedrag_vorderingsoort_13 — geen fuzzy matching, geen vrije tekst):
 * 1. Groepeer per contract de rijen met een bekend, niet-NaN `Bedrag_vorderingsoort_13` EN een
 *    geldige `Ingangsdatum_prijsregel` op of ná `bronPeildatum` (kalenderdag-vergelijking, zelfde
 *    grens als de pure calculator's eigen staleness-guard: "op" de peildatum telt al als geldig).
 * 2. Groepeer die rijen verder per exacte `Ingangsdatum_prijsregel`.
 * 3. Is het `Bedrag_vorderingsoort_13` binnen zo'n datumgroep UNANIEM (alle kandidaatrijen voor
 *    die datum geven exact hetzelfde bedrag) → één eenduidige `BgToekomstigeKortingswijziging`.
 * 4. Geven de kandidaatrijen voor diezelfde datum VERSCHILLENDE bedragen → niet eenduidig te
 *    herleiden: die ÉÉN datum wordt overgeslagen (geen giswerk, geen "hoogste Prijs_regelnr
 *    wint") en gemeld als BRONGAT-issue. Andere, wél eenduidige datums van HETZELFDE contract
 *    blijven gewoon meetellen — één ambigue datum beschadigt niet de rest van dat contract, en
 *    één contract met een BRONGAT beschadigt nooit een ander contract (elk contract wordt
 *    volledig onafhankelijk herleid).
 * 5. Een contract zonder enige (toekomstige) kandidaatrij levert een lege lijst — bestaand,
 *    veilig gedrag van de pure calculator (de huidige korting geldt dan ongewijzigd het hele
 *    begrotingsjaar), GEEN BRONGAT (er is domweg niets te herleiden, geen tegenstrijdigheid).
 */

export interface ContractPrijsregelIssue {
  ernst: "BRONGAT";
  contractnummer: string;
  bericht: string;
}

export interface ContractPrijsregelResolutieResultaat {
  /** Contractnr (identiek aan `contracten_huidig.xlsx`'s Contract-veld) → eenduidig herleide toekomstige kortingswijzigingen, oplopend gesorteerd op ingangsdatum. */
  perContract: ReadonlyMap<string, readonly BgToekomstigeKortingswijziging[]>;
  issues: readonly ContractPrijsregelIssue[];
}

function naarKalenderDag(datum: Date): Date {
  return new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate()));
}

/**
 * Herleidt per contract (binnen één administratie, al gefilterd op `bedrijfsnr`) de eenduidige
 * toekomstige VS=13-kortingswijzigingen uit de ruwe, geparste `contract_prijsregels`-rijen. Leest
 * niets, muteert niets — een pure functie op reeds ingelezen rijen (bronresolutie/parsing is de
 * verantwoordelijkheid van de aanroeper, zie `contractenRentrollAdapter.ts`).
 */
export function bepaalToekomstigeKortingswijzigingenPerContract(
  rijen: readonly GestaagdContractPrijsregel[],
  bedrijfsnr: string,
  bronPeildatum: Date,
): ContractPrijsregelResolutieResultaat {
  const issues: ContractPrijsregelIssue[] = [];
  const perContract = new Map<string, readonly BgToekomstigeKortingswijziging[]>();
  const peilKalenderdag = naarKalenderDag(bronPeildatum);

  const rijenPerContract = new Map<string, GestaagdContractPrijsregel[]>();
  for (const rij of rijen) {
    if (rij.bedrijfsnr !== bedrijfsnr) continue;
    const lijst = rijenPerContract.get(rij.contractnr) ?? [];
    lijst.push(rij);
    rijenPerContract.set(rij.contractnr, lijst);
  }

  for (const [contractnummer, contractRijen] of rijenPerContract) {
    const toekomstig = contractRijen.filter(
      (r): r is GestaagdContractPrijsregel & { ingangsdatumPrijsregel: Date; bedragVorderingsoort13: Decimal } =>
        r.ingangsdatumPrijsregel !== null &&
        !Number.isNaN(r.ingangsdatumPrijsregel.getTime()) &&
        naarKalenderDag(r.ingangsdatumPrijsregel).getTime() >= peilKalenderdag.getTime() &&
        r.bedragVorderingsoort13 !== null &&
        !r.bedragVorderingsoort13.isNaN(),
    );

    if (toekomstig.length === 0) {
      perContract.set(contractnummer, []);
      continue;
    }

    const perDatum = new Map<string, typeof toekomstig>();
    for (const r of toekomstig) {
      const sleutel = naarKalenderDag(r.ingangsdatumPrijsregel).toISOString().slice(0, 10);
      const groep = perDatum.get(sleutel) ?? [];
      groep.push(r);
      perDatum.set(sleutel, groep);
    }

    const wijzigingen: BgToekomstigeKortingswijziging[] = [];
    for (const [datumSleutel, groep] of perDatum) {
      const uniekeBedragen = new Set(groep.map((r) => r.bedragVorderingsoort13.toString()));
      if (uniekeBedragen.size > 1) {
        issues.push({
          ernst: "BRONGAT",
          contractnummer,
          bericht: `Contract ${contractnummer}: meerdere contract_prijsregels-kandidaten voor ingangsdatum ${datumSleutel} geven verschillende VS13-bedragen (${[...uniekeBedragen].join(", ")}) — niet eenduidig te herleiden, geen toekomstige kortingswijziging toegepast voor deze datum.`,
        });
        continue;
      }
      wijzigingen.push({ ingangsdatum: groep[0]!.ingangsdatumPrijsregel, nieuweKortingPerMaand: groep[0]!.bedragVorderingsoort13 });
    }

    wijzigingen.sort((a, b) => a.ingangsdatum.getTime() - b.ingangsdatum.getTime());
    perContract.set(contractnummer, wijzigingen);
  }

  return { perContract, issues };
}
