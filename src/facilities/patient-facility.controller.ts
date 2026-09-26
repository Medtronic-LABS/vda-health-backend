import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { FacilityDirectoryLoader } from './facility-directory.loader';
import { FacilitySearchService } from './facility-search.service';

type RequestWithIdentity = { user?: HostIdentity };

/** Read-only, source-backed facility discovery for authenticated mobile patients. */
@Controller('patient/facilities')
@UseGuards(AuthGuard)
export class PatientFacilityController {
  constructor(
    @InjectRepository(MobileUser)
    private readonly mobileUsers: Repository<MobileUser>,
    private readonly search: FacilitySearchService,
    private readonly directory: FacilityDirectoryLoader,
  ) {}

  @Get()
  async list(
    @Req() request: RequestWithIdentity,
    @Query() query: Record<string, string>,
  ) {
    const identity = this.mobileIdentity(request);
    const patient = await this.mobileUsers.findOne({
      where: {
        id: identity.mobileUserId,
        tenantId: identity.tenantId,
        isActive: true,
      },
    });
    if (!patient) throw new UnauthorizedException('Mobile patient is unavailable.');

    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
    const databaseResults = await this.search.searchWithSchemes(
      identity.tenantId,
      {
        state: patient.state,
        district: patient.district,
        query: query.query?.trim() || undefined,
        limit: 50,
      },
    );
    const directorySource = this.directory.source();
    const directoryResults = this.directory.find({
      state: patient.state,
      district: patient.district,
      limit: 50,
    });

    const facilities = new Map<string, Record<string, unknown>>();
    for (const result of databaseResults) {
      const facility = result.facility;
      facilities.set(facility.facilityId, {
        id: facility.facilityId,
        name: facility.name,
        facilityType: facility.hospitalType || null,
        ownership: null,
        address: facility.address || null,
        city: facility.city || facility.locality || null,
        district: facility.district || null,
        state: facility.state || null,
        contactNumber: facility.contactNumber || null,
        schemes: result.schemes,
        pmjayListed:
          facility.pmjayStatus === true ||
          result.schemes.some((scheme) =>
            ['PMJAY', 'AYUSHMANBHARAT'].includes(
              scheme.toUpperCase().replace(/[\s_-]+/g, ''),
            ),
          ),
        iphsLevel: result.iphsOverlay?.iphsLevel || 'UNKNOWN',
        emergencyCapability:
          result.iphsOverlay?.emergencyCapability ||
          (facility.emergencyAvailable === true
            ? 'SOURCE_REPORTED_CAPABLE'
            : facility.emergencyAvailable === false
              ? 'SOURCE_REPORTED_NOT_CAPABLE'
              : 'UNKNOWN'),
        distanceKm: result.distanceKm,
        travelTimeMinutes: result.travelTimeMinutes,
        sourceKind: 'STRUCTURED_FACILITY_DATABASE',
        sourceVersion: facility.sourceVersion || null,
      });
    }

    for (const facility of directoryResults) {
      if (facilities.has(facility.facilityId)) continue;
      facilities.set(facility.facilityId, {
        id: facility.facilityId,
        name: facility.name,
        facilityType: facility.facilityType,
        ownership: facility.ownership,
        address: facility.address,
        city: facility.city,
        district: facility.district,
        state: facility.state,
        contactNumber: facility.contact,
        schemes: facility.scheme ? [facility.scheme] : [],
        pmjayListed:
          facility.scheme?.toUpperCase().replace(/[\s-]+/g, '') === 'PMJAY',
        iphsLevel: facility.iphsLevel,
        emergencyCapability: 'UNKNOWN',
        distanceKm: null,
        travelTimeMinutes: null,
        sourceKind: 'NHA_FACILITY_DIRECTORY',
        sourceVersion: directorySource?.version || null,
      });
    }

    return {
      scope: {
        state: patient.state,
        district: patient.district,
        matchType: 'AREA',
      },
      facilities: [...facilities.values()]
        .sort((left, right) =>
          String(left.name).localeCompare(String(right.name)),
        )
        .slice(0, limit),
      notice:
        'Facilities are matched to your registered area. Current services and availability must be confirmed with the facility.',
    };
  }

  private mobileIdentity(request: RequestWithIdentity): HostIdentity & {
    mobileUserId: string;
  } {
    const identity = request.user;
    if (
      !identity ||
      identity.authType !== 'MOBILE' ||
      !identity.mobileUserId
    ) {
      throw new UnauthorizedException('Mobile authentication is required.');
    }
    return identity as HostIdentity & { mobileUserId: string };
  }
}
