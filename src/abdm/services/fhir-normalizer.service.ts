import { Injectable, Logger } from '@nestjs/common';
import {
  HealthRecordCategory,
  RawHealthRecord,
  RawHealthRecordBundle,
} from '../interfaces/health-record-service.interface';

@Injectable()
export class FhirNormalizerService {
  private readonly logger = new Logger(FhirNormalizerService.name);

  /**
   * Parses raw FHIR R4 payload (JSON string or object) into RawHealthRecordBundle[].
   */
  normalizeFhirBundle(
    fhirPayload: string | Record<string, unknown>,
    category: HealthRecordCategory,
    sourceRef = 'ABDM-HIP',
  ): RawHealthRecordBundle {
    const fetchedAt = new Date();
    let bundleObj: Record<string, unknown> = {};

    if (typeof fhirPayload === 'string') {
      try {
        bundleObj = JSON.parse(fhirPayload) as Record<string, unknown>;
      } catch {
        this.logger.warn(
          `[FHIR_NORMALIZER] Failed to parse FHIR payload as JSON for category=${category}`,
        );
        bundleObj = { rawText: fhirPayload };
      }
    } else {
      bundleObj = fhirPayload;
    }

    const records: RawHealthRecord[] = [];
    const entries =
      (bundleObj['entry'] as Array<Record<string, unknown>>) || [];

    if (entries.length === 0 && Object.keys(bundleObj).length > 0) {
      // If direct single resource payload
      const singleRecord = this.normalizeSingleResource(
        bundleObj,
        category,
        sourceRef,
        fetchedAt,
      );
      if (singleRecord) {
        records.push(singleRecord);
      }
    } else {
      for (const entry of entries) {
        const resource =
          (entry['resource'] as Record<string, unknown>) || entry;
        const normRecord = this.normalizeSingleResource(
          resource,
          category,
          sourceRef,
          fetchedAt,
        );
        if (normRecord) {
          records.push(normRecord);
        }
      }
    }

    return {
      category,
      records,
      partialResult: false,
      fetchedAt,
    };
  }

  private normalizeSingleResource(
    resource: Record<string, unknown>,
    category: HealthRecordCategory,
    sourceRef: string,
    fetchedAt: Date,
  ): RawHealthRecord | null {
    switch (category) {
      case HealthRecordCategory.MEDICATION:
      case HealthRecordCategory.PRESCRIPTION:
        return {
          category,
          sourceRef,
          fetchedAt,
          payload: {
            medicationName:
              this.extractCodeableConcept(
                resource['medicationCodeableConcept'],
              ) ||
              resource['medicationName'] ||
              'Prescribed Medication',
            dosage:
              this.extractDosage(resource['dosageInstruction']) ||
              resource['dosage'] ||
              'As directed',
            frequency: resource['frequency'] || 'Daily',
            instructions: resource['instructions'] || 'Take with water',
            status: resource['status'] || 'active',
            date:
              resource['authoredOn'] || resource['date']
                ? new Date(
                    (resource['authoredOn'] || resource['date']) as string,
                  )
                : new Date(),
          },
        };

      case HealthRecordCategory.LAB_REPORT:
      case HealthRecordCategory.INVESTIGATION:
        return {
          category,
          sourceRef,
          fetchedAt,
          payload: {
            testName:
              this.extractCodeableConcept(resource['code']) ||
              resource['testName'] ||
              'Laboratory Test',
            value:
              this.extractQuantityValue(resource['valueQuantity']) ||
              resource['value'] ||
              'Normal',
            unit:
              this.extractQuantityUnit(resource['valueQuantity']) ||
              resource['unit'] ||
              '',
            referenceRange: resource['referenceRange'] || 'Standard Range',
            interpretation: resource['interpretation'] || 'normal',
            observationDate: resource['effectiveDateTime']
              ? new Date(resource['effectiveDateTime'] as string)
              : new Date(),
            date: resource['effectiveDateTime']
              ? new Date(resource['effectiveDateTime'] as string)
              : new Date(),
          },
        };

      case HealthRecordCategory.DIAGNOSIS:
        return {
          category: HealthRecordCategory.DIAGNOSIS,
          sourceRef,
          fetchedAt,
          payload: {
            conditionName:
              this.extractCodeableConcept(resource['code']) ||
              resource['conditionName'] ||
              'Clinical Diagnosis',
            severity:
              this.extractCodeableConcept(resource['severity']) ||
              resource['severity'] ||
              'moderate',
            onsetDate: resource['onsetDateTime']
              ? new Date(resource['onsetDateTime'] as string)
              : new Date(),
            status: resource['clinicalStatus'] || 'active',
            date: resource['onsetDateTime']
              ? new Date(resource['onsetDateTime'] as string)
              : new Date(),
          },
        };

      case HealthRecordCategory.ALLERGY:
        return {
          category: HealthRecordCategory.ALLERGY,
          sourceRef,
          fetchedAt,
          payload: {
            allergen:
              this.extractCodeableConcept(resource['code']) ||
              resource['allergen'] ||
              'Known Allergen',
            reactionType: resource['reactionType'] || 'Hypersensitivity',
            severity: resource['criticality'] || 'mild',
            status: resource['verificationStatus'] || 'active',
            date: resource['recordedDate']
              ? new Date(resource['recordedDate'] as string)
              : new Date(),
          },
        };

      default:
        return {
          category,
          sourceRef,
          fetchedAt,
          payload: resource,
        };
    }
  }

  private extractCodeableConcept(val: unknown): string | null {
    if (!val || typeof val !== 'object') return null;
    const obj = val as Record<string, unknown>;
    if (obj['text'] && typeof obj['text'] === 'string') return obj['text'];
    if (Array.isArray(obj['coding']) && obj['coding'].length > 0) {
      const first = obj['coding'][0] as Record<string, unknown>;
      return (first['display'] as string) || (first['code'] as string) || null;
    }
    return null;
  }

  private extractDosage(dosages: unknown): string | null {
    if (!Array.isArray(dosages) || dosages.length === 0) return null;
    const first = dosages[0] as Record<string, unknown>;
    if (first['text']) return first['text'] as string;
    return null;
  }

  private extractQuantityValue(val: unknown): string | null {
    if (!val || typeof val !== 'object') return null;
    const obj = val as Record<string, unknown>;
    if (typeof obj['value'] === 'number' || typeof obj['value'] === 'string') {
      return String(obj['value']);
    }
    return null;
  }

  private extractQuantityUnit(val: unknown): string | null {
    if (!val || typeof val !== 'object') return null;
    const obj = val as Record<string, unknown>;
    if (typeof obj['unit'] === 'string') return obj['unit'];
    return null;
  }
}
