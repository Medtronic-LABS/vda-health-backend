import {
  Controller,
  Get,
  NotFoundException,
  Param,
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
import { Scheme } from '../database/entities/scheme.entity';
import { SchemeService } from './scheme.service';

type RequestWithIdentity = { user?: HostIdentity };

/** Governed scheme information for the authenticated mobile patient's state. */
@Controller('patient/schemes')
@UseGuards(AuthGuard)
export class PatientSchemeController {
  constructor(
    @InjectRepository(MobileUser)
    private readonly mobileUsers: Repository<MobileUser>,
    private readonly schemes: SchemeService,
  ) {}

  @Get()
  async list(
    @Req() request: RequestWithIdentity,
    @Query('query') query?: string,
  ) {
    const { identity, patient } = await this.patient(request);
    const schemes = await this.schemes.list(identity.tenantId, {
      state: patient.state,
      query: query?.trim() || undefined,
    });
    return {
      state: patient.state,
      eligibilityStatus: 'ELIGIBILITY_CHECK_REQUIRED',
      schemes: schemes.map((scheme) => this.patientView(scheme)),
      notice:
        'Eligibility requires official verification through the scheme authority.',
    };
  }

  @Get(':schemeId/eligibility')
  async eligibility(
    @Req() request: RequestWithIdentity,
    @Param('schemeId') schemeId: string,
  ) {
    const { identity, patient } = await this.patient(request);
    const result = await this.schemes.eligibilityAssistance(
      identity.tenantId,
      schemeId,
    );
    if (
      result.scheme.geographyScope === 'STATE' &&
      result.scheme.state?.toLocaleLowerCase() !== patient.state.toLocaleLowerCase()
    ) {
      throw new NotFoundException('SCHEME_NOT_AVAILABLE_FOR_PATIENT_STATE');
    }
    return {
      status: result.status,
      message: result.message,
      scheme: this.patientView(result.scheme),
    };
  }

  private patientView(scheme: Scheme) {
    return {
      id: scheme.schemeId,
      name: scheme.name,
      description: scheme.description || null,
      geographyScope: scheme.geographyScope,
      state: scheme.state || null,
      eligibilityCriteria: scheme.eligibilityCriteria || null,
      benefitsDescription: scheme.benefitsDescription || null,
      coverageInformation: scheme.coverageInformation || null,
      requiredDocuments: scheme.requiredDocuments || [],
      applicationProcess: scheme.applicationProcess || null,
      officialUrl: scheme.officialUrl || null,
      helpline: scheme.helpline || null,
      sourceVersion: scheme.sourceVersion || null,
      eligibilityStatus: 'ELIGIBILITY_CHECK_REQUIRED',
    };
  }

  private async patient(request: RequestWithIdentity) {
    const identity = request.user;
    if (
      !identity ||
      identity.authType !== 'MOBILE' ||
      !identity.mobileUserId
    ) {
      throw new UnauthorizedException('Mobile authentication is required.');
    }
    const patient = await this.mobileUsers.findOne({
      where: {
        id: identity.mobileUserId,
        tenantId: identity.tenantId,
        isActive: true,
      },
    });
    if (!patient) throw new UnauthorizedException('Mobile patient is unavailable.');
    return { identity, patient };
  }
}
