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

  async ensureMobilePilotConsent(tenantId: string, subjectId: string, language: string): Promise<ConsentArtifact> {
    const existing = await this.consentRepo.findOne({
      where: { tenantId, subjectId, status: 'ACTIVE', consentVersion: 'mobile-pilot-v1' },
    });
    if (existing) return existing;
    try {
      return await this.consentRepo.save(this.consentRepo.create({
        tenantId,
        subjectId,
        consentVersion: 'mobile-pilot-v1',
        scopes: ['record_read', 'conversation_retention'],
        language,
        deliveryMode: 'text',
        retentionInfo: { mode: 'mobile-pilot-profile' },
        status: 'ACTIVE',
      }));
    } catch (error: unknown) {
      // A unique partial index makes simultaneous first-session requests
      // converge on the same active mobile-pilot consent artifact.
      if ((error as { code?: string }).code !== '23505') throw error;
      const concurrent = await this.consentRepo.findOne({
        where: { tenantId, subjectId, status: 'ACTIVE', consentVersion: 'mobile-pilot-v1' },
      });
      if (concurrent) return concurrent;
      throw error;
    }
  }

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
