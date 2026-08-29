import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocument } from '../database/entities/knowledge-document.entity';
import { KnowledgeChunk } from '../database/entities/knowledge-chunk.entity';
import { KnowledgeEmbedding } from '../database/entities/knowledge-embedding.entity';
import { MultiFormatParserService } from './ingestion/multi-format-parser.service';
import { DocumentChunkerService } from './ingestion/document-chunker.service';
import { LocalSemanticEmbeddingProvider } from './providers/local/local-semantic-embedding.provider';
import { DevelopmentEmbeddingProvider } from './providers/development/development-embedding.provider';
import { DevelopmentKnowledgeService } from './services/development-knowledge.service';
import { KnowledgeRetrievalService } from './services/knowledge-retrieval.service';
import { KnowledgeAdminService } from './services/knowledge-admin.service';
import { KnowledgeQueryNormalizerService } from './services/knowledge-query-normalizer.service';
import { AdminKnowledgeController } from './controllers/admin-knowledge.controller';
import { ConfigurationModule } from '../configuration/configuration.module';
import { AuditModule } from '../audit/audit.module';
import { ObservabilityModule } from '../observability/observability.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeDocument,
      KnowledgeChunk,
      KnowledgeEmbedding,
    ]),
    ConfigurationModule,
    AuditModule,
    ObservabilityModule,
    AuthModule,
  ],
  controllers: [AdminKnowledgeController],
  providers: [
    MultiFormatParserService,
    DocumentChunkerService,
    LocalSemanticEmbeddingProvider,
    DevelopmentEmbeddingProvider,
    DevelopmentKnowledgeService,
    KnowledgeRetrievalService,
    KnowledgeAdminService,
    KnowledgeQueryNormalizerService,
  ],
  exports: [
    KnowledgeRetrievalService,
    KnowledgeAdminService,
    LocalSemanticEmbeddingProvider,
    DevelopmentKnowledgeService,
    KnowledgeQueryNormalizerService,
    MultiFormatParserService,
  ],
})
export class KnowledgeModule {}
