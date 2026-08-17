import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';

@Injectable()
export class ConsentService {
  constructor(
    @InjectRepository(ConsentArtifact)
    private readonly consentRepo: Repository<ConsentArtifact>,
  ) {}

  async validateConsent(
    consentArtifactId: string,
    tenantId: string,
    subjectId: string,
    requiredScopes?: string[],
  ): Promise<ConsentArtifact> {
    const consent = await this.consentRepo.findOne({
      where: { id: consentArtifactId },
    });

    if (!consent) {
      throw new ForbiddenException('CONSENT_MISSING');
    }

    // Verify tenant ownership
    if (consent.tenantId !== tenantId) {
      throw new ForbiddenException('CONSENT_MISSING');
    }

    // Verify subject association
    if (consent.subjectId !== subjectId) {
      throw new ForbiddenException('CONSENT_MISSING');
    }

    // Verify active status (reject WITHDRAWN or EXPIRED)
    if (consent.status !== 'ACTIVE') {
      throw new ForbiddenException('CONSENT_MISSING');
    }

    // Verify required scopes are a subset of granted scopes
    if (requiredScopes && requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every((scope) =>
        consent.scopes.includes(scope),
      );
      if (!hasAllScopes) {
        throw new ForbiddenException('CONSENT_MISSING');
      }
    }

    return consent;
  }
}
