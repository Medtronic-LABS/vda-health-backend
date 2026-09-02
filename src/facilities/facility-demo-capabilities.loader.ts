import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { IphsLevel } from './iphs-classification';

export interface DemoCapabilityItem {
  facilityId: string;
  facilityRecordId?: string;
  state: string;
  district: string;
  areaLocality?: string | null;
  serviceCode: string;
  serviceName: string;
  availability: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  sourceType: 'MANUAL_DEMO_MAPPING';
  source: string;
  verified: boolean;
  demoOnly: boolean;
  iphsLevel: IphsLevel;
  classificationBasis?: string | null;
  active: boolean;
}

export interface DemoCapabilityDataset {
  dataset: {
    name: string;
    version: string;
    sourceType: string;
    source: string;
    iphsReference?: string;
    verified: boolean;
    demoOnly: boolean;
  };
  facilities: Array<{
    facilityId: string;
    name: string;
    state: string;
    district: string;
    areaLocality?: string;
    iphsLevel: IphsLevel;
    services: Array<{
      code: string;
      name: string;
      availability?: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
    }>;
  }>;
}

@Injectable()
export class FacilityDemoCapabilitiesLoader {
  private readonly logger = new Logger(FacilityDemoCapabilitiesLoader.name);
  private readonly cache = new Map<string, DemoCapabilityItem[]>();

  public isEnabled(): boolean {
    const envSetting = process.env.FACILITY_DEMO_CAPABILITIES_ENABLED;
    if (envSetting === 'false') return false;
    if (envSetting === 'true') return true;
    return process.env.NODE_ENV !== 'production';
  }

  public getCapabilitiesForState(state?: string): DemoCapabilityItem[] {
    if (!this.isEnabled() || !state) return [];

    const normalizedState = this.normalizeStateFilename(state);
    if (!normalizedState) return [];

    if (this.cache.has(normalizedState)) {
      return this.cache.get(normalizedState)!;
    }

    const items = this.loadStateJson(normalizedState);
    this.cache.set(normalizedState, items);
    return items;
  }

  private normalizeStateFilename(state: string): string {
    const s = state.trim().toLowerCase();
    if (/^haryana$/i.test(s)) return 'haryana';
    if (/^himachal/i.test(s)) return 'himachal-pradesh';
    if (/^delhi$/i.test(s)) return 'delhi';
    if (/^punjab$/i.test(s)) return 'punjab';
    return s.replace(/\s+/g, '-');
  }

  private loadStateJson(stateFilename: string): DemoCapabilityItem[] {
    const possiblePaths = [
      path.join(__dirname, '..', 'data', 'facility-capabilities', `${stateFilename}.json`),
      path.join(process.cwd(), 'src', 'data', 'facility-capabilities', `${stateFilename}.json`),
      path.join(process.cwd(), 'dist', 'data', 'facility-capabilities', `${stateFilename}.json`),
    ];

    let filePath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        break;
      }
    }

    if (!filePath) {
      this.logger.debug(`No JSON capability dataset found for state: ${stateFilename}`);
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed: DemoCapabilityDataset = JSON.parse(content);
      const datasetMeta = parsed.dataset || {};
      const result: DemoCapabilityItem[] = [];

      for (const f of parsed.facilities || []) {
        for (const s of f.services || []) {
          result.push({
            facilityId: f.facilityId,
            state: (f.state || 'HARYANA').toUpperCase(),
            district: (f.district || 'FARIDABAD').toUpperCase(),
            areaLocality: f.areaLocality || null,
            serviceCode: s.code,
            serviceName: s.name,
            availability: s.availability || 'AVAILABLE',
            sourceType: (datasetMeta.sourceType as 'MANUAL_DEMO_MAPPING') || 'MANUAL_DEMO_MAPPING',
            source: datasetMeta.source || 'VDA Pilot Facility Mapping',
            verified: datasetMeta.verified ?? false,
            demoOnly: datasetMeta.demoOnly ?? true,
            iphsLevel: f.iphsLevel || 'UNKNOWN',
            classificationBasis: `MANUAL_DEMO_LEVEL_ALIGNMENT:${f.iphsLevel || 'UNKNOWN'};NOT_REAL_WORLD_VERIFIED`,
            active: true,
          });
        }
      }

      this.logger.log(`Loaded ${result.length} JSON demo capabilities for state ${stateFilename}`);
      return result;
    } catch (err: unknown) {
      this.logger.warn(`Failed to parse JSON capability dataset for ${stateFilename}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
}
