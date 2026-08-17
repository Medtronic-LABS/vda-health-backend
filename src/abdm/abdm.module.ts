import { Module, Logger } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { AuditModule } from '../audit/audit.module';
import { DevelopmentHealthRecordService } from './services/development-health-record.service';
import { AbdmHealthRecordService } from './services/abdm-health-record.service';
import { AbdmGatewayAuthService } from './services/abdm-gateway-auth.service';
import { AbdmEcdhService } from './services/abdm-ecdh.service';
import { FhirNormalizerService } from './services/fhir-normalizer.service';
import { ClinicalContextService } from './services/clinical-context.service';
import { AbdmHiuCallbackController } from './controllers/abdm-hiu-callback.controller';
import { ConfigurationService } from '../configuration/configuration.service';
import { ConfigurationModule } from '../configuration/configuration.module';

/**
 * AbdmModule — Health Record Provider Abstraction and Clinical Context Assembly.
 *
 * Provider Selection Logic:
 *  1. When ABDM_ENABLED=false (or credentials missing):
 *     Automatically uses DevelopmentHealthRecordService (returns synthetic fixtures; never calls ABDM).
 *  2. When ABDM_ENABLED=true AND valid ABDM production credentials are provided:
 *     Uses AbdmHealthRecordService (production-ready gateway client boundary).
 *
 * Missing credentials NEVER break application startup.
 */
@Module({
  imports: [ConsentModule, AuditModule, ConfigurationModule],
  controllers: [AbdmHiuCallbackController],
  providers: [
    DevelopmentHealthRecordService,
    AbdmHealthRecordService,
    AbdmGatewayAuthService,
    AbdmEcdhService,
    FhirNormalizerService,
    {
      provide: 'IHealthRecordService',
      useFactory: (
        config: ConfigurationService,
        devService: DevelopmentHealthRecordService,
        abdmService: AbdmHealthRecordService,
      ) => {
        const logger = new Logger('AbdmModule');
        const isAbdmConfigured =
          config.abdmEnabled &&
          Boolean(config.abdmBaseUrl) &&
          Boolean(config.abdmClientId) &&
          Boolean(config.abdmClientSecret) &&
          Boolean(config.abdmHiuId);

        if (config.abdmEnabled && !isAbdmConfigured) {
          logger.warn(
            'ABDM_ENABLED is set to true, but required production ABDM configuration (base URL, client ID, client secret, or HIU ID) is incomplete. Safely falling back to DevelopmentHealthRecordService without breaking application startup.',
          );
          return devService;
        }

        if (isAbdmConfigured) {
          logger.log(
            'Production ABDM configuration detected. Registering AbdmHealthRecordService.',
          );
          return abdmService;
        }

        logger.log(
          'ABDM_ENABLED is false. Registering DevelopmentHealthRecordService with synthetic fixtures.',
        );
        return devService;
      },
      inject: [
        ConfigurationService,
        DevelopmentHealthRecordService,
        AbdmHealthRecordService,
      ],
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
    DevelopmentHealthRecordService,
    AbdmHealthRecordService,
    AbdmGatewayAuthService,
    AbdmEcdhService,
    FhirNormalizerService,
  ],
})
export class AbdmModule {}
