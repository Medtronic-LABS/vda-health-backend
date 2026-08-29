import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagEvaluationTrace } from '../database/entities/rag-evaluation-trace.entity';
import { RagEvaluationService } from './rag-evaluation.service';
import { RagEvaluationController } from './rag-evaluation.controller';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({ imports: [TypeOrmModule.forFeature([RagEvaluationTrace]), AuthModule, KnowledgeModule], providers: [RagEvaluationService], controllers: [RagEvaluationController], exports: [RagEvaluationService] })
export class EvaluationModule {}
