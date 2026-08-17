import { FhirNormalizerService } from './services/fhir-normalizer.service';
import { HealthRecordCategory } from './interfaces/health-record-service.interface';

describe('FhirNormalizerService (Phase 7)', () => {
  let normalizer: FhirNormalizerService;

  beforeEach(() => {
    normalizer = new FhirNormalizerService();
  });

  it('1. Normalizes FHIR MedicationRequest bundle into RawHealthRecordBundle', () => {
    const fhirPayload = {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'MedicationRequest',
            medicationCodeableConcept: { text: 'Metformin 500mg' },
            dosageInstruction: [{ text: 'Take twice daily after meals' }],
            status: 'active',
            authoredOn: '2026-08-01T10:00:00Z',
          },
        },
      ],
    };

    const bundle = normalizer.normalizeFhirBundle(
      fhirPayload,
      HealthRecordCategory.MEDICATION,
      'HIP-REF-001',
    );

    expect(bundle.category).toBe(HealthRecordCategory.MEDICATION);
    expect(bundle.records.length).toBe(1);
    expect(bundle.records[0].payload.medicationName).toBe('Metformin 500mg');
    expect(bundle.records[0].payload.dosage).toBe(
      'Take twice daily after meals',
    );
  });

  it('2. Normalizes FHIR DiagnosticReport / Observation into Lab Report bundle', () => {
    const fhirPayload = {
      resourceType: 'Observation',
      code: { text: 'HbA1c' },
      valueQuantity: { value: 7.2, unit: '%' },
      referenceRange: '4.0–5.6',
      interpretation: 'abnormal',
      effectiveDateTime: '2026-08-10T08:00:00Z',
    };

    const bundle = normalizer.normalizeFhirBundle(
      fhirPayload,
      HealthRecordCategory.LAB_REPORT,
      'HIP-REF-LAB',
    );

    expect(bundle.category).toBe(HealthRecordCategory.LAB_REPORT);
    expect(bundle.records.length).toBe(1);
    expect(bundle.records[0].payload.testName).toBe('HbA1c');
    expect(bundle.records[0].payload.value).toBe('7.2');
    expect(bundle.records[0].payload.unit).toBe('%');
  });

  it('3. Normalizes FHIR Condition into Diagnosis bundle', () => {
    const fhirPayload = {
      resourceType: 'Condition',
      code: { text: 'Type 2 Diabetes Mellitus' },
      severity: { text: 'moderate' },
      onsetDateTime: '2025-01-15T00:00:00Z',
      clinicalStatus: 'active',
    };

    const bundle = normalizer.normalizeFhirBundle(
      fhirPayload,
      HealthRecordCategory.DIAGNOSIS,
      'HIP-REF-DIAG',
    );

    expect(bundle.category).toBe(HealthRecordCategory.DIAGNOSIS);
    expect(bundle.records.length).toBe(1);
    expect(bundle.records[0].payload.conditionName).toBe(
      'Type 2 Diabetes Mellitus',
    );
  });
});
