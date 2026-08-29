import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Facility } from '../database/entities/facility.entity';
import { FacilityScheme } from '../database/entities/facility-scheme.entity';

export type FacilitySearch = { state?: string; district?: string; city?: string; locality?: string; hospitalType?: string; pmjay?: boolean; query?: string; scheme?: string; speciality?: string; facilityId?: string; limit?: number };
export type FacilitySearchResult = { facility: Facility; schemes: string[] };
@Injectable()
export class FacilitySearchService {
  constructor(
    @InjectRepository(Facility) private readonly facilities: Repository<Facility>,
    @InjectRepository(FacilityScheme) private readonly facilitySchemes: Repository<FacilityScheme>,
  ) {}
  async search(tenantId: string, filters: FacilitySearch): Promise<Facility[]> {
    const state = this.normalizeState(filters.state);
    const district = this.normalizeDistrict(filters.district);
    const query = this.facilities.createQueryBuilder('facility').where('facility."tenantId" = :tenantId AND facility.active = true', { tenantId });
    if (state) query.andWhere('LOWER(facility.state) = LOWER(:state)', { state });
    if (district) query.andWhere('LOWER(facility.district) = LOWER(:district)', { district });
    if (filters.city) query.andWhere('LOWER(facility.city) = LOWER(:city)', { city: filters.city });
    if (filters.pmjay !== undefined) query.andWhere('facility."pmjayStatus" = :pmjay', { pmjay: filters.pmjay });
    if (filters.hospitalType) query.andWhere('LOWER(facility."hospitalType") LIKE LOWER(:hospitalType)', { hospitalType: `%${filters.hospitalType}%` });
    if (filters.locality) query.andWhere('(LOWER(facility.locality) LIKE LOWER(:locality) OR LOWER(facility.address) LIKE LOWER(:locality))', { locality: `%${filters.locality}%` });
    if (filters.query) query.andWhere('LOWER(facility.name) LIKE LOWER(:query)', { query: `%${filters.query}%` });
    if (filters.facilityId) query.andWhere('facility."facilityId" = :facilityId', { facilityId: filters.facilityId });
    if (filters.speciality) query.andWhere('facility."specialityCodes" @> :speciality::jsonb', { speciality: JSON.stringify([filters.speciality]) });
    if (filters.scheme) query.innerJoin(FacilityScheme, 'facility_scheme', 'facility_scheme."facilityId" = facility.id AND facility_scheme."tenantId" = facility."tenantId" AND facility_scheme.active = true AND facility_scheme.scheme = :scheme', { scheme: filters.scheme });
    return query.orderBy('facility.name', 'ASC').take(Math.min(Math.max(filters.limit || 10, 1), 50)).getMany();
  }

  /** Source-preserving aliases for common state spellings. */
  private normalizeState(state?: string): string | undefined {
    const normalized = state?.trim();
    if (!normalized) return undefined;
    if (/^himachal(\s+|-|_)*(pradesh|pardesh|prdesh)?$/i.test(normalized) || /^himachal$/i.test(normalized)) {
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
  async searchWithSchemes(tenantId: string, filters: FacilitySearch): Promise<FacilitySearchResult[]> {
    const facilities = await this.search(tenantId, filters);
    if (!facilities.length) return [];
    const associations = await this.facilitySchemes.find({
      where: { tenantId, facilityId: In(facilities.map((facility) => facility.id)), active: true },
      order: { scheme: 'ASC' },
    });
    const schemesByFacility = new Map<string, string[]>();
    for (const association of associations) {
      const schemes = schemesByFacility.get(association.facilityId) || [];
      schemes.push(association.scheme);
      schemesByFacility.set(association.facilityId, schemes);
    }
    return facilities.map((facility) => ({
      facility,
      schemes: schemesByFacility.get(facility.id) || [],
    }));
  }
}
