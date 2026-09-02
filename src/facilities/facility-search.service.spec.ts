import { Repository } from 'typeorm';
import { FacilityIphsOverlay } from '../database/entities/facility-iphs-overlay.entity';
import { FacilityScheme } from '../database/entities/facility-scheme.entity';
import { Facility } from '../database/entities/facility.entity';
import { FacilitySearchService } from './facility-search.service';

describe('FacilitySearchService IPHS ranking', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';

  const facility = (
    id: string,
    name: string,
    emergencyAvailable: boolean | null,
  ): Facility =>
    ({
      id,
      tenantId,
      facilityId: `SOURCE-${id}`,
      name,
      state: 'HARYANA',
      district: 'TEST',
      emergencyAvailable,
      active: true,
    }) as Facility;

  const overlay = (
    facilityId: string,
    emergencyCapability: string,
  ): FacilityIphsOverlay =>
    ({
      id: `OVERLAY-${facilityId}`,
      tenantId,
      facilityId,
      state: 'HARYANA',
      iphsLevel: 'CHC',
      iphsClassification: 'CHC_NOT_SUBCLASSIFIED',
      iphsServices: { status: 'NOT_VERIFIED', services: [] },
      emergencyCapability,
      referralLevel: 'SECONDARY',
      iphsSource: 'IPHS 2022',
      iphsVerified: false,
      active: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }) as FacilityIphsOverlay;

  const createService = (
    rows: Facility[],
    overlays: FacilityIphsOverlay[],
  ): FacilitySearchService => {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    const facilities = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<Facility>;
    const iphsOverlays = {
      find: jest.fn().mockResolvedValue(overlays),
    } as unknown as Repository<FacilityIphsOverlay>;
    const schemes = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<FacilityScheme>;
    const demoCapabilities = {
      find: jest.fn().mockResolvedValue([]),
    } as any;
    return new FacilitySearchService(
      facilities,
      iphsOverlays,
      schemes,
      demoCapabilities,
    );
  };

  it('prioritizes explicit emergency capability before shorter travel time', async () => {
    const capable = facility('A', 'Capable CHC', true);
    const unknown = facility('B', 'Unknown Hospital', null);
    const service = createService(
      [unknown, capable],
      [
        overlay(capable.id, 'SOURCE_REPORTED_CAPABLE'),
        overlay(unknown.id, 'UNKNOWN'),
      ],
    );

    const results = await service.searchWithSchemes(tenantId, {
      state: 'HARYANA',
      emergency: true,
      travelTimeMinutesByFacilityId: {
        [unknown.facilityId]: 5,
        [capable.facilityId]: 20,
      },
    });

    expect(results.map((result) => result.facility.id)).toEqual(['A', 'B']);
    expect(results[0]?.iphsOverlay?.iphsServices).toEqual({
      status: 'NOT_VERIFIED',
      services: [],
    });
  });

  it('uses travel time before distance for non-emergency nearest lookup', async () => {
    const fartherByTime = facility('A', 'A Hospital', null);
    const nearerByTime = facility('B', 'B Hospital', null);
    const service = createService([fartherByTime, nearerByTime], []);

    const results = await service.searchWithSchemes(tenantId, {
      state: 'HARYANA',
      travelTimeMinutesByFacilityId: {
        [fartherByTime.facilityId]: 30,
        [nearerByTime.facilityId]: 10,
      },
    });

    expect(results.map((result) => result.facility.id)).toEqual(['B', 'A']);
  });

  it('keeps generic facility search unchanged without attaching demo capabilities', async () => {
    const hospital = facility('A', 'CHC KHERI KALAN', null);
    const service = createService([hospital], []);

    const results = await service.searchWithSchemes(tenantId, {
      state: 'HARYANA',
      district: 'FARIDABAD',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.facility.name).toBe('CHC KHERI KALAN');
    expect(results[0]?.demoCapabilities).toEqual([]);
  });

  it('attaches JSON demo capabilities when serviceIphsLevels is passed for a service search', async () => {
    const hospital = facility('A', 'CHC KHERI KALAN', null);
    hospital.facilityId = 'HOSP6G03414';
    const demoLoader = {
      isEnabled: () => true,
      getCapabilitiesForState: () => [
        {
          facilityId: 'HOSP6G03414',
          state: 'HARYANA',
          district: 'FARIDABAD',
          serviceCode: 'XRAY',
          serviceName: 'X-ray',
          availability: 'AVAILABLE',
          sourceType: 'MANUAL_DEMO_MAPPING',
          source: 'VDA Pilot Facility Mapping',
          verified: false,
          demoOnly: true,
          iphsLevel: 'CHC',
          active: true,
        },
      ],
    } as any;

    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([hospital]),
    };
    const facilities = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<Facility>;
    const iphsOverlays = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<FacilityIphsOverlay>;
    const schemes = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<FacilityScheme>;

    const service = new FacilitySearchService(
      facilities,
      iphsOverlays,
      schemes,
      demoLoader,
    );

    const results = await service.searchWithSchemes(tenantId, {
      state: 'HARYANA',
      district: 'FARIDABAD',
      serviceIphsLevels: ['CHC', 'SDH', 'DH'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.demoCapabilities).toHaveLength(1);
    expect(results[0]?.demoCapabilities[0]?.serviceName).toBe('X-ray');
    expect(results[0]?.demoCapabilities[0]?.verified).toBe(false);
  });

  it('returns IPHS facility-level recommendations even when FACILITY_DEMO_CAPABILITIES_ENABLED is false', async () => {
    const hospital = facility('A', 'CHC KHERI KALAN', null);
    hospital.facilityId = 'HOSP6G03414';
    const disabledLoader = {
      isEnabled: () => false,
      getCapabilitiesForState: () => [],
    } as any;

    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([hospital]),
    };
    const facilities = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<Facility>;
    const iphsOverlays = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<FacilityIphsOverlay>;
    const schemes = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<FacilityScheme>;

    const service = new FacilitySearchService(
      facilities,
      iphsOverlays,
      schemes,
      disabledLoader,
    );

    const results = await service.searchWithSchemes(tenantId, {
      state: 'HARYANA',
      district: 'FARIDABAD',
      serviceIphsLevels: ['CHC', 'SDH', 'DH'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.facility.name).toBe('CHC KHERI KALAN');
    expect(results[0]?.demoCapabilities).toEqual([]);
  });
});
