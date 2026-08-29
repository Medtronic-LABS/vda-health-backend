import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeDocument } from '../database/entities/knowledge-document.entity';
import { Scheme } from '../database/entities/scheme.entity';

export type SchemeInput = Pick<Scheme, 'schemeId' | 'name' | 'description' | 'geographyScope' | 'state' | 'eligibilityCriteria' | 'benefitsDescription' | 'coverageInformation' | 'requiredDocuments' | 'applicationProcess' | 'officialUrl' | 'helpline' | 'sourceDocumentId' | 'sourceVersion' | 'active'>;
export type EligibilityAssistance = { status: 'ELIGIBLE_CONFIRMED' | 'NOT_ELIGIBLE_CONFIRMED' | 'ELIGIBILITY_CHECK_REQUIRED' | 'INSUFFICIENT_INFORMATION'; scheme: Scheme; message: string };

@Injectable()
export class SchemeService {
  constructor(@InjectRepository(Scheme) private readonly schemes: Repository<Scheme>, @InjectRepository(KnowledgeDocument) private readonly documents: Repository<KnowledgeDocument>) {}
  async list(tenantId: string, filters: { state?: string; scope?: string; query?: string }) {
    const query = this.schemes.createQueryBuilder('scheme').where('scheme."tenantId" = :tenantId AND scheme.active = true', { tenantId });
    if (filters.state) query.andWhere('(scheme."geographyScope" = :national OR LOWER(scheme.state) = LOWER(:state))', { national: 'NATIONAL', state: filters.state });
    if (filters.scope) query.andWhere('scheme."geographyScope" = :scope', { scope: filters.scope });
    if (filters.query) query.andWhere('LOWER(scheme.name) LIKE LOWER(:query)', { query: `%${filters.query}%` });
    return query.orderBy('scheme."geographyScope"', 'ASC').addOrderBy('scheme.name', 'ASC').getMany();
  }
  async upsert(tenantId: string, input: SchemeInput) {
    if (input.geographyScope === 'NATIONAL' && input.state) throw new BadRequestException('A national scheme must not have a state.');
    if (input.geographyScope === 'STATE' && !input.state) throw new BadRequestException('A state scheme requires an authoritative state.');
    const document = await this.documents.findOne({ where: { id: input.sourceDocumentId, tenantId } });
    if (!document || document.status !== 'ACTIVE') throw new BadRequestException('SCHEME_SOURCE_DOCUMENT_MUST_BE_ACTIVE');
    const existing = await this.schemes.findOne({ where: { tenantId, schemeId: input.schemeId } });
    return this.schemes.save(existing ? Object.assign(existing, input) : this.schemes.create({ ...input, tenantId }));
  }
  async eligibilityAssistance(tenantId: string, schemeId: string): Promise<EligibilityAssistance> {
    const scheme = await this.schemes.findOne({ where: { tenantId, schemeId, active: true } });
    if (!scheme) throw new NotFoundException('SCHEME_NOT_FOUND');
    return { status: 'ELIGIBILITY_CHECK_REQUIRED', scheme, message: 'Eligibility has not been verified. Please use the official route or assistance described by the source.' };
  }
}
