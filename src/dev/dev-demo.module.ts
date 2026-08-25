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

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, ConsentArtifact, SyntheticPatient, SyntheticPatientFeedback]), SessionsModule, AuthModule],
  controllers: [DevDemoController],
  providers: [SyntheticPatientService],
  exports: [SyntheticPatientService],
})
export class DevDemoModule {}
