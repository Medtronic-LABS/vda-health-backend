/**
 * AbdmHealthRecordService — Placeholder for future live ABDM integration.
 *
 * This file exists to define the architectural boundary for the future
 * production implementation. It must NOT make any real API calls.
 *
 * DECISION_REQUIRED before this can be implemented:
 *   1. ABDM HIE-CM/HIU API specification from NHA (sandbox + production)
 *   2. ABDM Gateway base URL
 *   3. HIU client credential type and registration procedure
 *   4. FHIR R4 resource profiles used in ABDM India
 *   5. Push vs. Pull data model for health information exchange
 *   6. Host app → VDA mechanism to pass ABDM consent artefact reference
 *   7. Request signing / ECDH encryption requirements
 *   8. ABDM rate limits and retry policies
 *   9. Token lifecycle (session tokens, refresh flow)
 *  10. ABDM production credentials and key management
 *
 * When ready, implement this class to replace DevelopmentHealthRecordService.
 * Toggle via the ABDM_ENABLED environment variable in AbdmModule.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  IHealthRecordService,
  HealthRecordRequest,
  HealthRecordResult,
} from '../interfaces/health-record-service.interface';

@Injectable()
export class AbdmHealthRecordService implements IHealthRecordService {
  private readonly logger = new Logger(AbdmHealthRecordService.name);

  fetchRecords(request: HealthRecordRequest): Promise<HealthRecordResult> {
    void request;
    // DECISION_REQUIRED: Implement live ABDM integration here.
    // See file-level comment for all blocking decisions.
    this.logger.error(
      'AbdmHealthRecordService.fetchRecords() is not yet implemented. ' +
        'See DECISION_REQUIRED items in this file.',
    );
    return Promise.reject(
      new Error(
        'AbdmHealthRecordService is not implemented. ' +
          'DECISION_REQUIRED: ABDM API specification, credentials, and integration contract.',
      ),
    );
  }
}
