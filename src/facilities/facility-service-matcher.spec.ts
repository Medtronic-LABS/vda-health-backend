import { Facility } from '../database/entities/facility.entity';
import { FacilityDemoCapability } from '../database/entities/facility-demo-capability.entity';
import { FacilitySearchResult } from './facility-search.service';
import {
  collectSourceBackedServiceValues,
  filterBySourceBackedServiceValues,
  matchSourceBackedServiceValues,
} from './facility-service-matcher';

describe('facility service source verification', () => {
  const result = (
    id: string,
    supportedServices: string[] | null,
    specialityCodes: string[] | null = null,
    demoCapabilities: FacilityDemoCapability[] = [],
  ): FacilitySearchResult => ({
    facility: {
      id,
      facilityId: id,
      name: id,
      supportedServices,
      specialityCodes,
    } as Facility,
    schemes: [],
    iphsOverlay: null,
    demoCapabilities,
    distanceKm: null,
    travelTimeMinutes: null,
  });

  it('returns only exact source-backed service names selected from request aliases', () => {
    const facilities = [
      result('A', ['Glycosylated haemoglobin']),
      result('B', ['Blood glucose']),
      result('C', null, ['Pathology']),
    ];
    const sourceValues = collectSourceBackedServiceValues(facilities);
    const matched = matchSourceBackedServiceValues(
      ['HbA1c', 'Glycosylated Haemoglobin'],
      sourceValues,
    );

    expect(matched).toEqual(['Glycosylated haemoglobin']);
    expect(
      filterBySourceBackedServiceValues(facilities, matched).map(
        ({ facility }) => facility.id,
      ),
    ).toEqual(['A']);
  });

  it('does not treat a broad speciality or IPHS expectation as facility proof', () => {
    const facilities = [result('A', null, ['Pathology'])];
    const sourceValues = collectSourceBackedServiceValues(facilities);

    expect(matchSourceBackedServiceValues(['CBC'], sourceValues)).toEqual([]);
    expect(filterBySourceBackedServiceValues(facilities, [])).toEqual([]);
  });

  it('matches an explicitly synthetic capability without modifying facility fields', () => {
    const demoCapability = {
      facilityId: 'A',
      state: 'HARYANA',
      district: 'FARIDABAD',
      serviceCode: 'ULTRASOUND',
      serviceName: 'Ultrasound',
      availability: 'AVAILABLE',
      sourceType: 'MANUAL_DEMO_MAPPING',
      source: 'VDA Pilot Facility Mapping',
      verified: false,
      demoOnly: true,
      iphsLevel: 'CHC',
      active: true,
    } as any;
    const facilities = [result('A', null, [], [demoCapability])];
    const sourceValues = collectSourceBackedServiceValues(facilities);
    const matched = matchSourceBackedServiceValues(
      ['Ultrasound'],
      sourceValues,
    );

    expect(matched).toEqual(['ULTRASOUND']);
    expect(facilities[0]?.facility.supportedServices).toBeNull();
    expect(filterBySourceBackedServiceValues(facilities, matched)).toHaveLength(
      1,
    );
  });
});
