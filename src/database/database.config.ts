import { Injectable } from '@nestjs/common';
import { TypeOrmOptionsFactory, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigurationService } from '../configuration/configuration.service';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { ConsentArtifact } from './entities/consent-artifact.entity';
import { ConsentEvent } from './entities/consent-event.entity';
import { Session } from './entities/session.entity';
import { ConversationTurn } from './entities/conversation-turn.entity';
import { AuditEvent } from './entities/audit-event.entity';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { KnowledgeEmbedding } from './entities/knowledge-embedding.entity';
import { SyntheticPatient } from './entities/synthetic-patient.entity';
import { SyntheticPatientFeedback } from './entities/synthetic-feedback.entity';
import { Facility } from './entities/facility.entity';
import { FacilityScheme } from './entities/facility-scheme.entity';
import { Scheme } from './entities/scheme.entity';
import { Prescription } from './entities/prescription.entity';
import { Medication } from './entities/medication.entity';
import { MedicationAdherenceEvent } from './entities/medication-adherence-event.entity';
import { RagEvaluationTrace } from './entities/rag-evaluation-trace.entity';
import { ClinicalEscalation } from './entities/clinical-escalation.entity';

@Injectable()
export class DatabaseConfigService implements TypeOrmOptionsFactory {
  constructor(private readonly configService: ConfigurationService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const isProd = this.configService.nodeEnv === 'production';
    return {
      type: 'postgres',
      host: this.configService.dbHost,
      port: this.configService.dbPort,
      username: this.configService.dbUsername,
      password: this.configService.dbPassword,
      database: this.configService.dbDatabase,
      entities: [
        Tenant,
        User,
        ConsentArtifact,
        ConsentEvent,
        Session,
        ConversationTurn,
        AuditEvent,
        KnowledgeDocument,
        KnowledgeChunk,
        KnowledgeEmbedding,
        SyntheticPatient,
        SyntheticPatientFeedback,
        Facility,
        FacilityScheme,
        Scheme,
        Prescription,
        Medication,
        MedicationAdherenceEvent,
        RagEvaluationTrace,
        ClinicalEscalation,
      ],
      synchronize: false,
      migrationsRun: false,
      logging: !isProd,
      poolSize: 10,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : false,
    };
  }
}
