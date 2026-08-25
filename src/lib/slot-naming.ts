/**
 * Resolves beneficiary-name collisions within a tontine session by
 * appending an incrementing numeric suffix (e.g. "Akamba" -> "Akamba2" ->
 * "Akamba3"), so slot names stay unique session-wide without rejecting the
 * submission outright. Comparison is case-insensitive/trim-normalized;
 * stored names keep the submitter's original trimmed casing plus the
 * suffix. `existingNames` should already contain every beneficiaryName
 * currently registered in the session (across all memberships).
 */
export function resolveUniqueSlotNames(existingNames: string[], requestedNames: string[]): string[] {
  const taken = new Set(existingNames.map(normalize));
  const resolved: string[] = [];

  for (const raw of requestedNames) {
    const trimmed = raw.trim();
    let candidate = trimmed;
    let suffix = 2;
    while (taken.has(normalize(candidate))) {
      candidate = `${trimmed}${suffix}`;
      suffix += 1;
    }
    taken.add(normalize(candidate));
    resolved.push(candidate);
  }

  return resolved;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}
