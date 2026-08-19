/* eslint-disable */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
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
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  async createDocument(
    dto: Partial<KnowledgeDocument>,
    filePayload?: IngestionFilePayload,
  ): Promise<KnowledgeDocument> {
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
      const existing = await this.docRepo.findOne({ where: { checksum } });
      if (existing) {
        this.logger.warn(
          `Duplicate checksum detected for document ${checksum}`,
        );
      }
    }

    const doc = this.docRepo.create({
      title: dto.title || 'Untitled Document',
      description: dto.description || null,
      source: dto.source || 'Admin Upload',
      sourceUrl: dto.sourceUrl || null,
      version: dto.version || '1.0',
      language: dto.language || 'hi',
      domain: dto.domain || 'clinical',
      category: dto.category || 'general_education',
      role: dto.role || null,
      state: dto.state || null,
      district: dto.district || null,
      status: 'UPLOADED',
      checksum,
      effectiveDate: dto.effectiveDate
        ? new Date(dto.effectiveDate)
        : new Date(),
      reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : null,
      metadata: {
        ...(dto.metadata || {}),
        contentSnippet: parsedContent.substring(0, 200),
      },
    });

    const saved = await this.docRepo.save(doc);

    if (parsedContent) {
      // Auto-trigger ingestion workflow
      await this.processDocument(saved.id, parsedContent);
    }

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId: '00000000-0000-0000-0000-000000000000',
        subjectAbhaRef: 'system_admin',
        actingPrincipal: 'admin',
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
  ): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');

    doc.status = 'PROCESSING';
    await this.docRepo.save(doc);

    try {
      // 1. Chunk document
      const tempDoc = {
        ...doc,
        content: rawContentText || doc.description || '',
      } as unknown as KnowledgeDocument;
      const chunksPayloads = this.chunkerService.chunkDocument(tempDoc, 1200);

      // Delete existing chunks if re-processing
      await this.chunkRepo.delete({ documentId: doc.id });

      const createdChunks: KnowledgeChunk[] = [];
      for (const payload of chunksPayloads) {
        const chunk = this.chunkRepo.create({
          documentId: doc.id,
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
          } catch {
            // Text fallback if DB pgvector extension not present
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
          tenantId: '00000000-0000-0000-0000-000000000000',
          subjectAbhaRef: 'system_admin',
          actingPrincipal: 'admin',
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

  async approveDocument(id: string): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    doc.status = 'APPROVED';
    const updated = await this.docRepo.save(doc);

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId: '00000000-0000-0000-0000-000000000000',
        subjectAbhaRef: 'system_admin',
        actingPrincipal: 'admin',
        correlationId: 'admin-action',
        action: 'knowledge_document_approved',
        entityName: 'knowledge_document',
        entityId: doc.id,
        details: { status: 'APPROVED' },
      });
    }

    return updated;
  }

  async publishDocument(id: string): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    doc.status = 'PUBLISHED';
    const updated = await this.docRepo.save(doc);

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId: '00000000-0000-0000-0000-000000000000',
        subjectAbhaRef: 'system_admin',
        actingPrincipal: 'admin',
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
    id: string,
    newVersionId?: string,
  ): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    doc.status = 'SUPERSEDED';
    if (newVersionId) {
      doc.metadata = { ...(doc.metadata || {}), supersededBy: newVersionId };
    }
    const updated = await this.docRepo.save(doc);

    if (this.auditService) {
      await this.auditService.logEvent({
        tenantId: '00000000-0000-0000-0000-000000000000',
        subjectAbhaRef: 'system_admin',
        actingPrincipal: 'admin',
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
    domain?: string;
    status?: KnowledgeStatus;
  }): Promise<KnowledgeDocument[]> {
    const where: any = {};
    if (query?.domain) where.domain = query.domain;
    if (query?.status) where.status = query.status;
    return this.docRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<KnowledgeDocument> {
    const doc = await this.docRepo.findOne({
      where: { id },
      relations: { chunks: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async updateDocument(
    id: string,
    dto: Partial<KnowledgeDocument>,
  ): Promise<KnowledgeDocument> {
    const doc = await this.findOne(id);
    Object.assign(doc, dto);
    return this.docRepo.save(doc);
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = await this.findOne(id);
    await this.docRepo.remove(doc);
  }

  async reindexAll(): Promise<{ reindexedCount: number }> {
    const docs = await this.docRepo.find();
    let reindexedCount = 0;
    for (const doc of docs) {
      if (doc.status === 'PUBLISHED' || doc.status === 'APPROVED') {
        await this.processDocument(doc.id);
        reindexedCount++;
      }
    }
    return { reindexedCount };
  }
}
