import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Facility } from '../database/entities/facility.entity';
import { FacilityIphsOverlay } from '../database/entities/facility-iphs-overlay.entity';
import { FacilityScheme } from '../database/entities/facility-scheme.entity';
import { IphsLevel, ReferralLevel } from './iphs-classification';
import {
  FacilityDemoCapabilitiesLoader,
  DemoCapabilityItem,
} from './facility-demo-capabilities.loader';

export type FacilitySearch = {
  state?: string;
  district?: string;
  city?: string;
  locality?: string;
  hospitalType?: string;
  pmjay?: boolean;
  query?: string;
  scheme?: string;
  speciality?: string;
  facilityId?: string;
  iphsLevel?: IphsLevel;
  iphsLevels?: IphsLevel[];
  /** Facility-level eligibility for a service: real overlay OR isolated demo alignment. */
  serviceIphsLevels?: IphsLevel[];
  referralLevel?: ReferralLevel;
  referralLevels?: ReferralLevel[];
  emergency?: boolean;
  originLatitude?: number;
  originLongitude?: number;
  travelTimeMinutesByFacilityId?: Readonly<Record<string, number>>;
  limit?: number;
};
export type FacilitySearchResult = {
  facility: Facility;
  schemes: string[];
  iphsOverlay: FacilityIphsOverlay | null;
  demoCapabilities: DemoCapabilityItem[];
  distanceKm: number | null;
  travelTimeMinutes: number | null;
};
@Injectable()
export class FacilitySearchService {
  constructor(
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
    @InjectRepository(FacilityIphsOverlay)
    private readonly iphsOverlays: Repository<FacilityIphsOverlay>,
    @InjectRepository(FacilityScheme)
    private readonly facilitySchemes: Repository<FacilityScheme>,
    @Optional() private readonly demoCapabilitiesLoader?: FacilityDemoCapabilitiesLoader,
  ) {}
  async search(tenantId: string, filters: FacilitySearch): Promise<Facility[]> {
    const state = this.normalizeState(filters.state);
    const district = this.normalizeDistrict(filters.district);
    const query = this.facilities
      .createQueryBuilder('facility')
      .where('facility."tenantId" = :tenantId AND facility.active = true', {
        tenantId,
      });
    if (state)
      query.andWhere('LOWER(facility.state) = LOWER(:state)', { state });
    if (district)
      query.andWhere('LOWER(facility.district) = LOWER(:district)', {
        district,
      });
    if (filters.city)
      query.andWhere('LOWER(facility.city) = LOWER(:city)', {
        city: filters.city,
      });
    if (filters.pmjay !== undefined)
      query.andWhere('facility."pmjayStatus" = :pmjay', {
        pmjay: filters.pmjay,
      });
    if (filters.hospitalType?.toUpperCase() === 'PUBLIC') {
      query.andWhere(
        `(LOWER(facility."hospitalType") LIKE '%public%' OR LOWER(facility."hospitalType") LIKE '%government%' OR UPPER(facility."hospitalType") = 'GOI')`,
      );
    } else if (filters.hospitalType) {
      query.andWhere(
        'LOWER(facility."hospitalType") LIKE LOWER(:hospitalType)',
        { hospitalType: `%${filters.hospitalType}%` },
      );
    }
    if (filters.locality)
      query.andWhere(
        '(LOWER(facility.locality) LIKE LOWER(:locality) OR LOWER(facility.address) LIKE LOWER(:locality))',
        { locality: `%${filters.locality}%` },
      );
    if (filters.query)
      query.andWhere('LOWER(facility.name) LIKE LOWER(:query)', {
        query: `%${filters.query}%`,
      });
    if (filters.facilityId)
      query.andWhere('facility."facilityId" = :facilityId', {
        facilityId: filters.facilityId,
      });
    if (filters.speciality)
      query.andWhere(
        '(facility."specialityCodes" @> :speciality::jsonb OR facility."supportedServices" @> :speciality::jsonb)',
        { speciality: JSON.stringify([filters.speciality]) },
      );
    if (filters.scheme)
      query.innerJoin(
        FacilityScheme,
        'facility_scheme',
        'facility_scheme."facilityId" = facility.id AND facility_scheme."tenantId" = facility."tenantId" AND facility_scheme.active = true AND facility_scheme.scheme = :scheme',
        { scheme: filters.scheme },
      );
    if (
      filters.iphsLevel ||
      filters.iphsLevels?.length ||
      filters.referralLevel ||
      filters.referralLevels?.length
    ) {
      query.innerJoin(
        FacilityIphsOverlay,
        'iphs_filter',
        'iphs_filter."facilityId" = facility.id AND iphs_filter."tenantId" = facility."tenantId" AND iphs_filter.active = true',
      );
      if (filters.iphsLevel)
        query.andWhere('iphs_filter."iphsLevel" = :iphsLevel', {
          iphsLevel: filters.iphsLevel,
        });
      if (filters.iphsLevels?.length)
        query.andWhere('iphs_filter."iphsLevel" IN (:...iphsLevels)', {
          iphsLevels: filters.iphsLevels,
        });
      if (filters.referralLevel)
        query.andWhere('iphs_filter."referralLevel" = :referralLevel', {
          referralLevel: filters.referralLevel,
        });
      if (filters.referralLevels?.length)
        query.andWhere('iphs_filter."referralLevel" IN (:...referralLevels)', {
          referralLevels: filters.referralLevels,
        });
    }
    if (filters.serviceIphsLevels?.length) {
      query
        .leftJoin(
          FacilityIphsOverlay,
          'iphs_service_level',
          'iphs_service_level."facilityId" = facility.id AND iphs_service_level."tenantId" = facility."tenantId" AND iphs_service_level.active = true',
        )
        .andWhere(
          'iphs_service_level."iphsLevel" IN (:...serviceIphsLevels)',
          { serviceIphsLevels: filters.serviceIphsLevels },
        )
        .distinct(true);
    }
    const requestedLimit = Math.min(Math.max(filters.limit || 10, 1), 50);
    const candidateLimit =
      filters.emergency ||
      this.hasOrigin(filters) ||
      filters.travelTimeMinutesByFacilityId
        ? 50
        : requestedLimit;
    return query.orderBy('facility.name', 'ASC').take(candidateLimit).getMany();
  }

  /** Source-preserving aliases for common state spellings. */
  private normalizeState(state?: string): string | undefined {
    const normalized = state?.trim();
    if (!normalized) return undefined;
    if (
      /^himachal(\s+|-|_)*(pradesh|pardesh|prdesh)?$/i.test(normalized) ||
      /^himachal$/i.test(normalized)
    ) {
      return 'HIMACHAL_PRADESH';
    }
    if (/^haryana$/i.test(normalized)) return 'HARYANA';
    if (/^delhi$/i.test(normalized)) return 'Delhi';
    return normalized.toUpperCase().replace(/\s+/g, '_');
  }

  /** Source-preserving aliases for common district spellings; facility data is never altered. */
  private normalizeDistrict(district?: string): string | undefined {
    const normalized = district?.trim();
    if (!normalized) return undefined;
    const clean = normalized.replace(/\s+district$/i, '').trim();
    if (/^gurugram$|^gurgaon$/i.test(clean)) return 'GURUGRAM';
    if (/^mandi$/i.test(clean)) return 'Mandi';
    if (/^kangra$/i.test(clean)) return 'Kangra';
    if (/^solan$/i.test(clean)) return 'Solan';
    if (/^una$/i.test(clean)) return 'Una';
    if (/^shimla$/i.test(clean)) return 'Shimla';
    if (/^kullu$/i.test(clean)) return 'Kullu';
    if (/^hamirpur$/i.test(clean)) return 'Hamirpur';
    if (/^bilaspur$/i.test(clean)) return 'Bilaspur';
    if (/^sirmaur$/i.test(clean)) return 'Sirmaur';
    if (/^chamba$/i.test(clean)) return 'Chamba';
    if (/^kinnaur$/i.test(clean)) return 'Kinnaur';
    if (/^lahul(\s+and\s+)?spiti$/i.test(clean)) return 'Lahul And Spiti';
    return clean;
  }

  /** Returns only source-backed scheme associations for patient-facing cards. */
  async searchWithSchemes(
    tenantId: string,
    filters: FacilitySearch,
  ): Promise<FacilitySearchResult[]> {
    const facilities = await this.search(tenantId, filters);
    if (!facilities.length) return [];
    const associations = await this.facilitySchemes.find({
      where: {
        tenantId,
        facilityId: In(facilities.map((facility) => facility.id)),
        active: true,
      },
      order: { scheme: 'ASC' },
    });
    const schemesByFacility = new Map<string, string[]>();
    for (const association of associations) {
      const schemes = schemesByFacility.get(association.facilityId) || [];
      schemes.push(association.scheme);
      schemesByFacility.set(association.facilityId, schemes);
    }
    const overlays = await this.iphsOverlays.find({
      where: {
        tenantId,
        facilityId: In(facilities.map((facility) => facility.id)),
        active: true,
      },
    });
    const overlaysByFacility = new Map(
      overlays.map((overlay) => [overlay.facilityId, overlay]),
    );
    const demoCapabilities = (filters.serviceIphsLevels?.length && this.demoCapabilitiesLoader?.isEnabled())
      ? this.demoCapabilitiesLoader.getCapabilitiesForState(filters.state || 'HARYANA')
      : [];
    const demoCapabilitiesByFacility = new Map<
      string,
      DemoCapabilityItem[]
    >();
    for (const capability of demoCapabilities) {
      const existing =
        demoCapabilitiesByFacility.get(capability.facilityId) || [];
      existing.push(capability);
      demoCapabilitiesByFacility.set(capability.facilityId, existing);
    }
    const results = facilities.map((facility) => {
      const travelTime =
        filters.travelTimeMinutesByFacilityId?.[facility.facilityId] ??
        filters.travelTimeMinutesByFacilityId?.[facility.id];
      return {
        facility,
        schemes: schemesByFacility.get(facility.id) || [],
        iphsOverlay: overlaysByFacility.get(facility.id) || null,
        demoCapabilities:
          demoCapabilitiesByFacility.get(facility.facilityId) ||
          demoCapabilitiesByFacility.get(facility.id) ||
          [],
        distanceKm: this.distanceKm(facility, filters),
        travelTimeMinutes:
          Number.isFinite(travelTime) && travelTime! >= 0 ? travelTime! : null,
      };
    });
    return results
      .sort((left, right) =>
        this.compareResults(left, right, Boolean(filters.emergency)),
      )
      .slice(0, Math.min(Math.max(filters.limit || 10, 1), 50));
  }

  private hasOrigin(filters: FacilitySearch): boolean {
    return (
      Number.isFinite(filters.originLatitude) &&
      Number.isFinite(filters.originLongitude)
    );
  }

  private distanceKm(
    facility: Facility,
    filters: FacilitySearch,
  ): number | null {
    if (
      !this.hasOrigin(filters) ||
      facility.latitude == null ||
      facility.longitude == null
    )
      return null;
    const latitude = Number(facility.latitude);
    const longitude = Number(facility.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const latDelta = toRadians(latitude - filters.originLatitude!);
    const lonDelta = toRadians(longitude - filters.originLongitude!);
    const a =
      Math.sin(latDelta / 2) ** 2 +
      Math.cos(toRadians(filters.originLatitude!)) *
        Math.cos(toRadians(latitude)) *
        Math.sin(lonDelta / 2) ** 2;
    return (
      Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) /
      10
    );
  }

  private compareResults(
    left: FacilitySearchResult,
    right: FacilitySearchResult,
    emergency: boolean,
  ): number {
    if (emergency) {
      const capabilityRank = (result: FacilitySearchResult): number => {
        const capability = result.iphsOverlay?.emergencyCapability;
        if (
          capability === 'SOURCE_REPORTED_CAPABLE' ||
          result.facility.emergencyAvailable === true
        )
          return 0;
        if (
          capability === 'SOURCE_REPORTED_NOT_CAPABLE' ||
          result.facility.emergencyAvailable === false
        )
          return 2;
        return 1;
      };
      const capabilityDifference = capabilityRank(left) - capabilityRank(right);
      if (capabilityDifference) return capabilityDifference;
    }
    const travelDifference =
      (left.travelTimeMinutes ?? Number.POSITIVE_INFINITY) -
      (right.travelTimeMinutes ?? Number.POSITIVE_INFINITY);
    if (travelDifference) return travelDifference;
    const distanceDifference =
      (left.distanceKm ?? Number.POSITIVE_INFINITY) -
      (right.distanceKm ?? Number.POSITIVE_INFINITY);
    if (distanceDifference) return distanceDifference;
    return left.facility.name.localeCompare(right.facility.name);
  }
}
