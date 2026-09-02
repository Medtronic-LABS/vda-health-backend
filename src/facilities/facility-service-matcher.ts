import { FacilitySearchResult } from './facility-search.service';

const normalizeSourceValue = (value: string): string =>
  value.trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' ');

/**
 * Returns the bounded vocabulary actually asserted by the facility source.
 * IPHS overlay services are intentionally excluded because they are standards,
 * not proof of an individual facility's capability.
 */
export function collectSourceBackedServiceValues(
  results: FacilitySearchResult[],
  limit = 200,
): string[] {
  const values = new Map<string, string>();
  for (const { facility, demoCapabilities } of results) {
    for (const value of [
      ...(facility.supportedServices || []),
      ...(facility.specialityCodes || []),
      ...demoCapabilities.flatMap((capability) => [
        capability.serviceCode,
        capability.serviceName,
      ]),
    ]) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const normalized = normalizeSourceValue(value);
      if (!values.has(normalized)) values.set(normalized, value.trim());
      if (values.size >= limit) return [...values.values()];
    }
  }
  return [...values.values()];
}

/** Accepts only model selections present in the closed source vocabulary. */
export function matchSourceBackedServiceValues(
  requestedTerms: string[],
  sourceValues: string[],
): string[] {
  const normalizedTerms = new Set(
    requestedTerms.filter(Boolean).map(normalizeSourceValue),
  );
  return sourceValues.filter((value) =>
    normalizedTerms.has(normalizeSourceValue(value)),
  );
}

/** Keeps only facilities whose own structured source contains a validated value. */
export function filterBySourceBackedServiceValues(
  results: FacilitySearchResult[],
  verifiedValues: string[],
): FacilitySearchResult[] {
  const verified = new Set(verifiedValues.map(normalizeSourceValue));
  if (!verified.size) return [];
  return results.filter(({ facility, demoCapabilities }) =>
    [
      ...(facility.supportedServices || []),
      ...(facility.specialityCodes || []),
      ...demoCapabilities.flatMap((capability) => [
        capability.serviceCode,
        capability.serviceName,
      ]),
    ].some(
      (value) =>
        typeof value === 'string' && verified.has(normalizeSourceValue(value)),
    ),
  );
}
