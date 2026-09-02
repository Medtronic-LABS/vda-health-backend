import {
  classifyIphsFacility,
  supportsIphsOverlay,
} from './iphs-classification';

describe('IPHS facility classification', () => {
  it('keeps ambiguous public hospital data unknown and unverified', () => {
    expect(
      classifyIphsFacility({
        hospitalType: 'Public',
        emergencyAvailable: null,
      }),
    ).toEqual({
      iphsLevel: 'UNKNOWN',
      iphsClassification: 'UNKNOWN',
      referralLevel: 'UNKNOWN',
      emergencyCapability: 'UNKNOWN',
      classificationBasis: 'hospitalType:PUBLIC',
    });
  });

  it('maps an explicit CHC type without inferring FRU capability', () => {
    expect(
      classifyIphsFacility({
        hospitalType: 'CHC',
        emergencyAvailable: true,
      }),
    ).toEqual({
      iphsLevel: 'CHC',
      iphsClassification: 'CHC_NOT_SUBCLASSIFIED',
      referralLevel: 'SECONDARY',
      emergencyCapability: 'SOURCE_REPORTED_CAPABLE',
      classificationBasis: 'hospitalType:CHC',
    });
  });

  it('limits overlays to Haryana and Himachal Pradesh', () => {
    expect(supportsIphsOverlay('HARYANA')).toBe(true);
    expect(supportsIphsOverlay('Himachal Pradesh')).toBe(true);
    expect(supportsIphsOverlay('Delhi')).toBe(false);
  });
});
