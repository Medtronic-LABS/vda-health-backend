import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../database/entities/tenant.entity';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { SyntheticPatient } from '../database/entities/synthetic-patient.entity';
import { SyntheticPatientFeedback } from '../database/entities/synthetic-feedback.entity';
import { DevDemoController } from './dev-demo.controller';
import { SessionsModule } from '../sessions/sessions.module';
import { AuthModule } from '../auth/auth.module';
import { SyntheticPatientService } from './synthetic-patient.service';
import { PATIENT_DATA_PROVIDER } from './patient-data/patient-data-provider.interface';
import { FilePatientDataProvider } from './patient-data/file-patient-data.provider';
import { SyntheticPatientDataProvider } from './patient-data/synthetic-patient-data.provider';
import { CompositePatientDataProvider } from './patient-data/composite-patient-data.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, ConsentArtifact, SyntheticPatient, SyntheticPatientFeedback]), SessionsModule, AuthModule],
  controllers: [DevDemoController],
  providers: [
    SyntheticPatientService,
    FilePatientDataProvider,
    SyntheticPatientDataProvider,
    CompositePatientDataProvider,
    { provide: PATIENT_DATA_PROVIDER, useExisting: CompositePatientDataProvider },
  ],
  exports: [SyntheticPatientService, PATIENT_DATA_PROVIDER],
})
export class DevDemoModule {}
