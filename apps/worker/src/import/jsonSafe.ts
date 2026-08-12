import Decimal from "decimal.js";
import type { Prisma } from "@bvc/db";

/**
 * `raw` in de gestaagde rijtypes (@bvc/data-contracts) is de door Zod
 * getypeerde bronrij (Decimal/Date i.p.v. tekst) — structureel 1-op-1 met
 * de brontabel, maar niet direct JSON-serialiseerbaar. Deze helper zet dat
 * om naar een vorm die de Postgres `Json`-kolom kan opslaan, zonder de
 * waarden zelf te wijzigen (alleen representatie, geen betekenis).
 */
export function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, val: unknown) => {
      if (val instanceof Decimal) return val.toString();
      if (val instanceof Date) return val.toISOString();
      return val;
    }),
  ) as Prisma.InputJsonValue;
}
