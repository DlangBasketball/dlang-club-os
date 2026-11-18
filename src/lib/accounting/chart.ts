/**
 * Default chart of accounts for a Swiss club (based on the Swiss SME / KMU
 * chart, "Kontenrahmen KMU") and the default mapping of club money events to
 * accounts. Names are translated (i18n keys under accounting.chart.accounts),
 * numbers are the KMU numbers. Every club can edit both afterwards.
 *
 * [Verify with your accountant / fiduciary] The numbers follow the KMU chart
 * conventions (1xxx assets, 2xxx liabilities, 3xxx revenue, 4-6xxx expenses);
 * clubs with an existing chart should map to their own numbers instead.
 * VAT codes: many clubs are VAT-exempt; the codes below are placeholders in
 * the style used by Swiss accounting software and must be checked against the
 * target software's VAT code list before the first import.
 */
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type DefaultAccount = { number: string; type: AccountType };

export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { number: "1000", type: "asset" },     // cash
  { number: "1020", type: "asset" },     // bank
  { number: "1090", type: "asset" },     // card / TWINT clearing (Stripe)
  { number: "1100", type: "asset" },     // receivables (debtors)
  { number: "2000", type: "liability" }, // payables (creditors)
  { number: "2030", type: "liability" }, // family credit (customer prepayments)
  { number: "2200", type: "liability" }, // VAT payable
  { number: "3000", type: "income" },    // membership / recurring fees
  { number: "3200", type: "income" },    // shop sales
  { number: "3400", type: "income" },    // camps
  { number: "3410", type: "income" },    // training
  { number: "3420", type: "income" },    // team season fees
  { number: "3600", type: "income" },    // other income
  { number: "3610", type: "income" },    // dunning fees
  { number: "3805", type: "expense" },   // bad-debt losses (write-offs)
  { number: "4000", type: "expense" },   // merchandise / material
  { number: "5000", type: "expense" },   // coach pay / wages
  { number: "6000", type: "expense" },   // facilities / rent
  { number: "6500", type: "expense" },   // administration
  { number: "6600", type: "expense" },   // marketing
  { number: "6840", type: "expense" },   // bank and payment fees
];

export const INCOME_KINDS = ["camp", "training", "team_season", "shop", "membership", "other"] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

export const CORE_MAPPING_KEYS = [
  "bank", "cash", "receivables", "stripe_clearing", "stripe_fees", "vat_payable", "family_credit", "payables",
  "writeoff", "dunning_fees",
] as const;
export type CoreMappingKey = (typeof CORE_MAPPING_KEYS)[number];

export const DEFAULT_MAPPINGS: { key: string; account: string | null; vatCode?: string | null }[] = [
  { key: "bank", account: "1020" },
  { key: "cash", account: "1000" },
  { key: "receivables", account: "1100" },
  { key: "stripe_clearing", account: "1090" },
  { key: "stripe_fees", account: "6840" },
  { key: "vat_payable", account: "2200" },
  { key: "family_credit", account: "2030" },
  { key: "payables", account: "2000" },
  { key: "writeoff", account: "3805" },
  { key: "dunning_fees", account: "3610" },
  { key: "income.camp", account: "3400" },
  { key: "income.training", account: "3410" },
  { key: "income.team_season", account: "3420" },
  { key: "income.shop", account: "3200" },
  { key: "income.membership", account: "3000" },
  { key: "income.other", account: "3600" },
  { key: "expense.default", account: "6500" },
  // Swiss VAT rates from 2024: 8.1 % standard, 2.6 % reduced, 3.8 % accommodation. [Verify codes]
  { key: "vat.8.1", account: null, vatCode: "UN81" },
  { key: "vat.2.6", account: null, vatCode: "UR26" },
  { key: "vat.3.8", account: null, vatCode: "UB38" },
];

/** "8.1" for 8.100, null for 0 / missing. */
export function vatKey(rate: number | string | null | undefined): string | null {
  const n = Number(rate ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `vat.${Number(n.toFixed(3))}`;
}

const MAPPING_KEY_RE = /^(bank|cash|receivables|stripe_clearing|stripe_fees|vat_payable|family_credit|payables|writeoff|dunning_fees|income\.(camp|training|team_season|shop|membership|other)|expense\.(default|[0-9a-f-]{36})|vat\.[0-9]{1,2}(\.[0-9]{1,3})?)$/;
export const isMappingKey = (k: string) => MAPPING_KEY_RE.test(k);
export const ACCOUNT_NUMBER_RE = /^[0-9A-Za-z.\-]{1,20}$/;
export const VAT_CODE_RE = /^[0-9A-Za-z._\-]{1,20}$/;
