/** Database error message -> i18n key (forms, contracts, registration form). */
const MAP: [RegExp, string][] = [
  [/FORM_VERSION_NOT_CURRENT/, "forms.errors.versionChanged"],
  [/FORM_VERSION_IMMUTABLE|SUBMISSION_IMMUTABLE/, "forms.errors.immutable"],
  [/FORM_EMPTY/, "forms.errors.formEmpty"],
  [/CONTRACT_IMMUTABLE|CONTRACT_SIGN_VIA_RPC/, "forms.errors.contractImmutable"],
  [/CONTRACT_NOT_SIGNABLE/, "forms.errors.contractNotSignable"],
  [/SIGNER_NAME_REQUIRED/, "forms.errors.signerName"],
  [/CROSS_ORG_REFERENCE|INVALID_IP_HASH|invalid input syntax/, "forms.errors.invalidRequest"],
  [/NOT_PERMITTED|row-level security|permission denied/, "forms.errors.notPermitted"],
  [/duplicate key/, "forms.errors.duplicate"],
];

export function formsErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  for (const [re, key] of MAP) if (re.test(m)) return key;
  return "forms.errors.generic";
}
