import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { DevelopmentHealthRecordService } from './services/development-health-record.service';
import { ClinicalContextService } from './services/clinical-context.service';

/**
 * AbdmModule — Phase 5 offline Clinical Context foundation.
 *
 * Development mode: IHealthRecordService → DevelopmentHealthRecordService
 *   (returns deterministic synthetic fixtures; never calls ABDM)
 *
 * Production mode (DECISION_REQUIRED — pending ABDM specifications):
 *   Replace DevelopmentHealthRecordService with AbdmHealthRecordService
 *   controlled by ABDM_ENABLED environment variable.
 */
@Module({
  imports: [ConsentModule],
  providers: [
    {
      provide: 'IHealthRecordService',
      useClass: DevelopmentHealthRecordService,
    },
    {
      provide: 'IClinicalContextService',
      useClass: ClinicalContextService,
    },
    ClinicalContextService,
  ],
  exports: [
    'IHealthRecordService',
    'IClinicalContextService',
    ClinicalContextService,
  ],
})
export class AbdmModule {}
