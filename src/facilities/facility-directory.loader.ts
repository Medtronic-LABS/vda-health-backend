import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { IphsLevel } from './iphs-classification';

export interface FacilityDirectoryEntry {
  facilityId: string;
  name: string;
  facilityType: string;
  ownership: 'GOVERNMENT' | 'PRIVATE';
  address: string | null;
  city: string | null;
  district: string;
  state: string;
  country: string | null;
  contact: string | null;
  scheme: string | null;
  iphsLevel: IphsLevel;
  specialities: string[];
  latitude: number | null;
  longitude: number | null;
}

export interface FacilityDirectoryQuery {
  state?: string;
  district?: string;
  ownership?: string;
  /** Ranking preference only; unlike ownership, it does not exclude entries. */
  preferOwnership?: string;
  iphsLevels?: IphsLevel[];
  facilityId?: string;
  scheme?: string;
  limit?: number;
}

type FacilityDirectoryDataset = {
  schemaVersion: string;
  dataset: { id: string; name: string; source: string };
  facilities: Array<{
    facilityId?: unknown;
    name?: unknown;
    facilityType?: unknown;
    ownership?: unknown;
    address?: unknown;
    city?: unknown;
    district?: unknown;
    state?: unknown;
    country?: unknown;
    contact?: unknown;
    scheme?: unknown;
    iphsLevel?: unknown;
    specialities?: unknown;
    location?: { latitude?: unknown; longitude?: unknown };
  }>;
};

const DIRECTORY_ID = 'haryana-faridabad-pmjay-facilities';
const IPHS_LEVELS = new Set<IphsLevel>([
  'HWC_SHC',
  'HWC_PHC',
  'CHC',
  'SDH',
  'DH',
  'UNKNOWN',
]);

/**
 * Read-only source directory for the Faridabad PM-JAY pilot. This service
 * deliberately does not use repositories or persist records: individual
 * service availability is not present in the NHA listing.
 */
@Injectable()
export class FacilityDirectoryLoader {
  private readonly logger = new Logger(FacilityDirectoryLoader.name);
  private loaded: {
    version: string;
    source: string;
    facilities: FacilityDirectoryEntry[];
  } | null = null;

  public find(query: FacilityDirectoryQuery): FacilityDirectoryEntry[] {
    const directory = this.getDirectory();
    if (!directory) return [];

    const state = this.normalize(query.state);
    const district = this.normalize(query.district);
    const ownership = this.normalizeOwnership(query.ownership);
    const preferredOwnership = this.normalizeOwnership(query.preferOwnership);
    const levels = new Set<Exclude<IphsLevel, 'UNKNOWN'>>(
      (query.iphsLevels || []).filter(
        (level): level is Exclude<IphsLevel, 'UNKNOWN'> => level !== 'UNKNOWN',
      ),
    );
    const scheme = this.normalizeScheme(query.scheme);
    const limit = Math.min(Math.max(query.limit || 50, 1), 50);

    return directory.facilities
      .filter((facility) => !state || this.normalize(facility.state) === state)
      .filter(
        (facility) =>
          !district || this.normalize(facility.district) === district,
      )
      .filter(
        (facility) => !ownership || facility.ownership === ownership,
      )
      .filter(
        (facility) =>
          !query.facilityId || facility.facilityId === query.facilityId,
      )
      .filter((facility) => !scheme || this.normalizeScheme(facility.scheme) === scheme)
      .filter(
        (facility) =>
          !levels.size ||
          (facility.iphsLevel !== 'UNKNOWN' && levels.has(facility.iphsLevel)),
      )
      .sort((left, right) => {
        const leftRank = left.ownership === preferredOwnership ? 0 : 1;
        const rightRank = right.ownership === preferredOwnership ? 0 : 1;
        return leftRank - rightRank || left.name.localeCompare(right.name);
      })
      .slice(0, limit);
  }

  public source(): { version: string; source: string } | null {
    const directory = this.getDirectory();
    return directory
      ? { version: directory.version, source: directory.source }
      : null;
  }

  private getDirectory(): {
    version: string;
    source: string;
    facilities: FacilityDirectoryEntry[];
  } | null {
    if (this.loaded) return this.loaded;

    const filePath = this.directoryPath();
    if (!filePath) {
      this.logger.warn('Faridabad NHA facility directory was not found.');
      return null;
    }

    try {
      const parsed = JSON.parse(
        fs.readFileSync(filePath, 'utf8'),
      ) as FacilityDirectoryDataset;
      if (
        !parsed ||
        typeof parsed.schemaVersion !== 'string' ||
        parsed.dataset?.id !== DIRECTORY_ID ||
        typeof parsed.dataset.source !== 'string' ||
        !Array.isArray(parsed.facilities)
      ) {
        throw new Error('Unexpected directory structure');
      }

      const facilities = parsed.facilities.map((facility, index) =>
        this.validateFacility(facility, index),
      );
      this.loaded = {
        version: parsed.schemaVersion,
        source: parsed.dataset.source,
        facilities,
      };
      this.logger.log(`Loaded ${facilities.length} NHA Faridabad facilities.`);
      return this.loaded;
    } catch (error: unknown) {
      this.logger.warn(
        `Unable to load Faridabad NHA facility directory: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private validateFacility(
    facility: FacilityDirectoryDataset['facilities'][number],
    index: number,
  ): FacilityDirectoryEntry {
    const required = (value: unknown, field: string): string => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Invalid ${field} at facility index ${index}`);
      }
      return value.trim();
    };
    const optional = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value.trim() : null;
    const ownership = required(facility.ownership, 'ownership').toUpperCase();
    if (ownership !== 'GOVERNMENT' && ownership !== 'PRIVATE') {
      throw new Error(`Invalid ownership at facility index ${index}`);
    }
    const iphsLevel = required(facility.iphsLevel, 'iphsLevel').toUpperCase();
    if (!IPHS_LEVELS.has(iphsLevel as IphsLevel)) {
      throw new Error(`Invalid iphsLevel at facility index ${index}`);
    }
    const coordinate = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;

    return {
      facilityId: required(facility.facilityId, 'facilityId'),
      name: required(facility.name, 'name'),
      facilityType: required(facility.facilityType, 'facilityType'),
      ownership,
      address: optional(facility.address),
      city: optional(facility.city),
      district: required(facility.district, 'district'),
      state: required(facility.state, 'state'),
      country: optional(facility.country),
      contact: optional(facility.contact),
      scheme: optional(facility.scheme),
      iphsLevel: iphsLevel as IphsLevel,
      specialities: Array.isArray(facility.specialities)
        ? facility.specialities.filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value.trim()),
          )
        : [],
      latitude: coordinate(facility.location?.latitude),
      longitude: coordinate(facility.location?.longitude),
    };
  }

  private directoryPath(): string | null {
    const candidates = [
      path.join(
        __dirname,
        '..',
        'data',
        'facility-directories',
        `${DIRECTORY_ID}.json`,
      ),
      path.join(
        process.cwd(),
        'src',
        'data',
        'facility-directories',
        `${DIRECTORY_ID}.json`,
      ),
      path.join(
        process.cwd(),
        'dist',
        'data',
        'facility-directories',
        `${DIRECTORY_ID}.json`,
      ),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  private normalize(value?: string | null): string | null {
    return value?.trim().toLocaleUpperCase('en-IN') || null;
  }

  private normalizeOwnership(value?: string): 'GOVERNMENT' | 'PRIVATE' | null {
    const normalized = this.normalize(value);
    if (!normalized) return null;
    if (normalized === 'PUBLIC' || normalized === 'GOVERNMENT' || normalized === 'GOI')
      return 'GOVERNMENT';
    if (normalized === 'PRIVATE') return 'PRIVATE';
    return null;
  }

  private normalizeScheme(value?: string | null): string | null {
    const normalized = this.normalize(value);
    return normalized?.replace(/[\s-]+/g, '') || null;
  }
}
