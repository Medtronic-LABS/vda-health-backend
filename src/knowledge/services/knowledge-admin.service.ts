/* eslint-disable */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  KnowledgeDocument,
  KnowledgeStatus,
} from '../../database/entities/knowledge-document.entity';
import { KnowledgeChunk } from '../../database/entities/knowledge-chunk.entity';
import { KnowledgeEmbedding } from '../../database/entities/knowledge-embedding.entity';
import { MultiFormatParserService } from '../ingestion/multi-format-parser.service';
import { DocumentChunkerService } from '../ingestion/document-chunker.service';
import { LocalSemanticEmbeddingProvider } from '../providers/local/local-semantic-embedding.provider';
import { AuditService } from '../../audit/audit.service';
import { IngestionFilePayload } from '../interfaces/knowledge-ingestion.interface';
import { ConfigurationService } from '../../configuration/configuration.service';

@Injectable()
export class KnowledgeAdminService {
  private readonly logger = new Logger(KnowledgeAdminService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepo: Repository<KnowledgeChunk>,
    @InjectRepository(KnowledgeEmbedding)
    private readonly embeddingRepo: Repository<KnowledgeEmbedding>,
    private readonly parserService: MultiFormatParserService,
    private readonly chunkerService: DocumentChunkerService,
    private readonly embeddingProvider: LocalSemanticEmbeddingProvider,
    private readonly configService: ConfigurationService,
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  async createDocument(
    dto: Partial<KnowledgeDocument>,
    filePayload?: IngestionFilePayload,
    tenantId?: string,
    actor = 'admin',
  ): Promise<KnowledgeDocument> {
    if (!tenantId) throw new BadRequestException('Authenticated tenant is required.');
    let parsedContent = dto.description || '';
    let checksum = dto.checksum || null;

    if (filePayload) {
      const parsed = await this.parserService.parseDocument(
        filePayload.buffer,
        filePayload.filename,
        filePayload.mimeType,
      );
      parsedContent = parsed.content;
      checksum = parsed.checksum;
      dto.title = dto.title || parsed.title;
    }

    if (checksum) {
      const existing = await this.docRepo.findOne({ where: { checksum, tenantId } });
      if (existing) {
        throw new ConflictException('An identical knowledge document already exists.');
      }
    }

    const doc = this.docRepo.create({
      tenantId,
      title: dto.title || 'Untitled Document',
      description: dto.description || null,
      source: dto.source || 'Admin Upload',
      sourceUrl: dto.sourceUrl || null,
      version: dto.version || 'unspecified',
      language: dto.language || 'hi',
      domain: dto.domain || 'clinical',
      category: dto.category || 'general_education',
      role: dto.role || null,
      state: dto.state || null,
      district: dto.district || null,
      status: 'UPLOADED',
      checksum,
      effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null,
      reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null,
      metadata: {
        ...(dto.metadata || {}),
        contentSnippet: parsedContent.substring(0, 200),
        // Retained only to support explicit, auditable reindexing. It is never
        // returned in patient provenance and is not patient clinical data.
        rawContent: parsedContent,
      },
    });

    const saved = await this.docRepo.save(doc);

    if (parsedContent) {
      // Auto-trigger ingestion workflow
      await this.processDocument(saved.id, parsedContent, tenantId, actor);
    }

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId,
        subjectAbhaRef: 'system_admin',
        actingPrincipal: actor,
        correlationId: 'admin-action',
        action: 'knowledge_document_uploaded',
        entityName: 'knowledge_document',
        entityId: saved.id,
        details: { title: saved.title, domain: saved.domain },
      });
    }

    return saved;
  }

  async processDocument(
    documentId: string,
    rawContentText?: string,
    tenantId?: string,
    actor = 'admin',
  ): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id: documentId, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');

    doc.status = 'PROCESSING';
    await this.docRepo.save(doc);

    try {
      // 1. Chunk document
      const tempDoc = {
        ...doc,
      content:
        rawContentText ||
        (doc.metadata && typeof doc.metadata.rawContent === 'string'
          ? doc.metadata.rawContent
          : doc.description) ||
        '',
      } as unknown as KnowledgeDocument;
      const chunksPayloads = this.chunkerService.chunkDocument(
        tempDoc,
        this.configService.knowledgeMaxChunkLength,
      );

      if (chunksPayloads.length === 0) {
        throw new BadRequestException('Document contains no indexable text.');
      }

      // Delete existing chunks if re-processing
      await this.chunkRepo.delete({ documentId: doc.id });

      const createdChunks: KnowledgeChunk[] = [];
      for (const payload of chunksPayloads) {
        const chunk = this.chunkRepo.create({
          documentId: doc.id,
          tenantId: doc.tenantId,
          documentVersion: doc.version,
          content: payload.content,
          chunkIndex: payload.chunkIndex,
          language: payload.language,
          domain: payload.domain,
          category: payload.category,
          role: payload.role,
          state: payload.state,
          district: payload.district,
          source: payload.source,
          metadata: payload.metadata,
        });
        const savedChunk = await this.chunkRepo.save(chunk);
        createdChunks.push(savedChunk);

        // 2. Generate dense 384-dim semantic embedding
        const embeddingVector = await this.embeddingProvider.generateEmbedding(
          payload.content,
        );

        // 3. Save embedding in PostgreSQL pgvector format
        const vectorStr = `[${embeddingVector.join(',')}]`;

        if (this.dataSource && this.dataSource.isInitialized) {
          try {
            await this.dataSource.query(
              `INSERT INTO knowledge_embeddings ("chunkId", "embedding", "embeddingModel", "embeddingDimension") 
               VALUES ($1, $2::vector, $3, $4);`,
              [savedChunk.id, vectorStr, 'all-MiniLM-L6-v2', 384],
            );
          } catch (error: unknown) {
            if (this.configService.knowledgeRagEnabled) {
              throw error;
            }
            const emb = this.embeddingRepo.create({
              chunkId: savedChunk.id,
              embedding: vectorStr,
              embeddingModel: 'all-MiniLM-L6-v2',
              embeddingDimension: 384,
            });
            await this.embeddingRepo.save(emb);
          }
        } else {
          const emb = this.embeddingRepo.create({
            chunkId: savedChunk.id,
            embedding: vectorStr,
            embeddingModel: 'all-MiniLM-L6-v2',
            embeddingDimension: 384,
          });
          await this.embeddingRepo.save(emb);
        }
      }

      doc.status = 'REVIEW_REQUIRED';
      const updated = await this.docRepo.save(doc);

      if (this.auditService) {
        await this.auditService.logEvent({
          tenantId: doc.tenantId,
          subjectAbhaRef: 'system_admin',
          actingPrincipal: actor,
          correlationId: 'admin-action',
          action: 'knowledge_document_processed',
          entityName: 'knowledge_document',
          entityId: doc.id,
          details: { chunks_created: createdChunks.length },
        });
      }

      return updated;
    } catch (err: unknown) {
      doc.status = 'FAILED';
      await this.docRepo.save(doc);
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Document processing failed for ${documentId}: ${msg}`);
      throw new BadRequestException(`Ingestion failed: ${msg}`);
    }
  }

  async approveDocument(id: string, tenantId: string, actor = 'admin'): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');

    if (doc.status !== 'REVIEW_REQUIRED') {
      throw new BadRequestException('Only processed documents can be approved.');
    }
    doc.status = 'APPROVED';
    const updated = await this.docRepo.save(doc);

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId,
        subjectAbhaRef: 'system_admin',
        actingPrincipal: actor,
        correlationId: 'admin-action',
        action: 'knowledge_document_approved',
        entityName: 'knowledge_document',
        entityId: doc.id,
        details: { status: 'APPROVED' },
      });
    }

    return updated;
  }

  async publishDocument(id: string, tenantId: string, actor = 'admin'): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');

    if (doc.status !== 'APPROVED') {
      throw new BadRequestException('Only approved documents can be published.');
    }
    doc.status = 'ACTIVE';
    const updated = await this.docRepo.save(doc);

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId,
        subjectAbhaRef: 'system_admin',
        actingPrincipal: actor,
        correlationId: 'admin-action',
        action: 'knowledge_document_published',
        entityName: 'knowledge_document',
        entityId: doc.id,
        details: { status: 'PUBLISHED' },
      });
    }

    return updated;
  }

  async supersedeDocument(
    id: string, tenantId: string,
    newVersionId?: string, actor = 'admin',
  ): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('Document not found');

    if (!['PUBLISHED', 'ACTIVE', 'APPROVED'].includes(doc.status)) {
      throw new BadRequestException('Only approved or published documents can be superseded.');
    }
    doc.status = 'SUPERSEDED';
    if (newVersionId) {
      doc.metadata = { ...(doc.metadata || {}), supersededBy: newVersionId };
    }
    const updated = await this.docRepo.save(doc);

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId,
        subjectAbhaRef: 'system_admin',
        actingPrincipal: actor,
        correlationId: 'admin-action',
        action: 'knowledge_document_superseded',
        entityName: 'knowledge_document',
        entityId: doc.id,
        details: { status: 'SUPERSEDED', newVersionId },
      });
    }

    return updated;
  }

  async findAll(query?: {
    tenantId: string;
    domain?: string;
    status?: KnowledgeStatus;
  }): Promise<KnowledgeDocument[]> {
    const where: any = { tenantId: query?.tenantId };
    if (query?.domain) where.domain = query.domain;
    if (query?.status) where.status = query.status;
    return this.docRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string, tenantId: string): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({
      where: { id, tenantId },
      relations: { chunks: { embedding: true } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async updateDocument(
    id: string,
    tenantId: string,
    dto: Partial<KnowledgeDocument>,
  ): Promise<KnowledgeDocument> {
    const doc = await this.findOne(id, tenantId);
    const immutable = ['id', 'checksum', 'status', 'createdAt', 'updatedAt', 'chunks'];
    for (const key of immutable) delete (dto as Record<string, unknown>)[key];
    Object.assign(doc, dto);
    return this.docRepo.save(doc);
  }

  async deleteDocument(id: string, tenantId: string): Promise<void> {
    const doc = await this.findOne(id, tenantId);
    await this.docRepo.remove(doc);
  }

  async reindexAll(tenantId: string, actor = 'admin'): Promise<{ reindexedCount: number }> {
    const docs = await this.docRepo.find({ where: { tenantId } });
    let reindexedCount = 0;
    for (const doc of docs) {
      if (doc.status === 'PUBLISHED' || doc.status === 'APPROVED') {
        await this.processDocument(doc.id, undefined, tenantId, actor);
        reindexedCount++;
      }
    }
    return { reindexedCount };
  }
}
