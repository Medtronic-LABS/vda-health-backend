import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Facility } from '../database/entities/facility.entity';
import { FacilityScheme } from '../database/entities/facility-scheme.entity';
import { KnowledgeChunk } from '../database/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../database/entities/knowledge-document.entity';
import { FacilityAdminController } from './facility-admin.controller';
import { FacilityImportService } from './facility-import.service';
import { FacilitySearchService } from './facility-search.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [TypeOrmModule.forFeature([Facility, FacilityScheme, KnowledgeDocument, KnowledgeChunk]), AuthModule, KnowledgeModule],
  controllers: [FacilityAdminController],
  providers: [FacilityImportService, FacilitySearchService],
  exports: [FacilitySearchService],
})
export class FacilityModule {}
