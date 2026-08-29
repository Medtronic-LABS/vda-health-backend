/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IHealthRecordService,
  HealthRecordRequest,
  HealthRecordResult,
  HealthRecordCategory,
  RawHealthRecord,
  RawHealthRecordBundle,
} from '../interfaces/health-record-service.interface';
import { SyntheticPatientService } from '../../dev/synthetic-patient.service';
import { PrescriptionService } from '../../prescriptions/prescription.service';
import { MedicationService } from '../../medications/medication.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Session } from '../../database/entities/session.entity';

/**
 * DevelopmentHealthRecordService
 *
 * A synthetic development implementation of IHealthRecordService.
 *
 * IMPORTANT:
 *   - This service NEVER calls the internet or any ABDM endpoint.
 *   - It returns deterministic synthetic health records for testing.
 *   - It does NOT represent real ABDM consent, FHIR payloads, or HIE flows.
 *   - All data is clearly synthetic and marked with [SYNTHETIC-DEV-FIXTURE].
 *
 * Swapping this for AbdmHealthRecordService in production requires:
 *   DECISION_REQUIRED:
 *     - ABDM HIE-CM/HIU API specification
 *     - ABDM Gateway base URL and HIU credentials
 *     - FHIR R4 resource profiles used in ABDM India
 *     - Push vs. Pull data model for ABDM HIE
 *     - Host app → VDA ABDM consent artefact handoff format
 *     - Request signing / ECDH encryption requirements
 */
@Injectable()
export class DevelopmentHealthRecordService implements IHealthRecordService {
  private readonly logger = new Logger(DevelopmentHealthRecordService.name);

  // Development-only authorized subject reference (matches DEV_AUTH_SUBJECT_ABHA_REF)
  private static readonly DEV_SUBJECT_REF = 'dev-subject-abha-ref-123';
  private static readonly DEV_TENANT_ID =
    '00000000-0000-0000-0000-000000000000';

  constructor(@Optional() private readonly syntheticPatients?: SyntheticPatientService, @Optional() private readonly prescriptions?: PrescriptionService, @Optional() private readonly medicationService?: MedicationService, @InjectDataSource() private readonly dataSource?: DataSource) {}

  async fetchRecords(
    request: HealthRecordRequest,
  ): Promise<HealthRecordResult> {
    const { subjectContext, categories, dateRangeStart } = request;

    this.logger.log(
      `[DEV] fetchRecords categories=${categories.join(',')} sessionId=${subjectContext.sessionId}`,
    );

    // In a synthetic demo, consent remains bound to the host identity while the
    // session supplies the server-authorized synthetic record reference. Never
    // accept a synthetic subject reference directly from patient input.
    const session = this.dataSource ? await this.dataSource.getRepository(Session).findOne({ where: { id: subjectContext.sessionId, tenantId: subjectContext.tenantId, externalId: subjectContext.subjectAbhaRef } }) : null;
    const recordSubjectRef = session?.subjectAbhaRef.startsWith('synthetic:') ? session.subjectAbhaRef : subjectContext.subjectAbhaRef;
    // Subject isolation: only serve records for development-authorized subjects and tenants
    const syntheticPatient = this.syntheticPatients && recordSubjectRef.startsWith('synthetic:')
      ? await this.syntheticPatients.getByReference(subjectContext.tenantId, recordSubjectRef)
      : null;
    if (
      ((subjectContext.subjectAbhaRef !==
        DevelopmentHealthRecordService.DEV_SUBJECT_REF &&
        subjectContext.subjectAbhaRef !== 'dev-host-user-123') ||
        subjectContext.tenantId !== DevelopmentHealthRecordService.DEV_TENANT_ID) &&
      !syntheticPatient
    ) {
      this.logger.warn(
        `[DEV] Subject or tenant mismatch — returning empty records`,
      );
      return {
        bundles: [],
        unavailableCategories: categories,
        providerErrorCodes: ['DEV_SUBJECT_NOT_FOUND'],
      };
    }

    const bundles: RawHealthRecordBundle[] = [];
    const unavailableCategories: HealthRecordCategory[] = [];
    const now = new Date();

    for (const category of categories) {
      const records = syntheticPatient
        ? await this.getPatientRecords(syntheticPatient, category, now)
        : this.getSyntheticRecords(category, now, dateRangeStart);
      bundles.push({
        category,
        records,
        partialResult: false,
        fetchedAt: now,
      });
    }

    return {
      bundles,
      unavailableCategories,
      providerErrorCodes: [],
    };
  }

  private async getPatientRecords(patient: { tenantId: string; syntheticPatientId: string; clinicalProfile: Record<string, unknown> }, category: HealthRecordCategory, now: Date): Promise<RawHealthRecord[]> {
    const profile = patient.clinicalProfile;
    const records = (key: string) => Array.isArray(profile[key]) ? profile[key] as Array<Record<string, unknown>> : [];
    const source = 'synthetic-development-patient';
    const map = (items: Array<Record<string, unknown>>, payload: (item: Record<string, unknown>) => Record<string, unknown>) =>
      items.map((item, index) => ({ category, sourceRef: `${source}-${category}-${index + 1}`, fetchedAt: now, payload: { ...payload(item), date: now } }));
    switch (category) {
      case HealthRecordCategory.MEDICATION:
        const confirmed = this.medicationService ? await this.medicationService.activeForPatient(patient.tenantId, `synthetic:${patient.syntheticPatientId}`) : [];
        // Uploaded candidates are intentionally excluded until explicit medication confirmation.
        if (confirmed.length) return confirmed.map((medication, index) => ({ category, sourceRef: `confirmed-medication-${medication.sourcePrescriptionId}-${index + 1}`, fetchedAt: now, payload: { medicationName: medication.name, dosage: medication.strength || medication.dosage || null, frequency: medication.frequency || null, route: medication.route || null, startDate: medication.startDate || medication.createdAt, endDate: medication.endDate || null, status: 'active', date: medication.createdAt } }));
        return map(records('medications'), (x) => ({ medicationName: x.name, dosage: x.dosage, frequency: x.frequency, route: x.route || 'Oral', startDate: x.startDate || now, endDate: null, status: 'active' }));
      case HealthRecordCategory.PRESCRIPTION:
        const uploaded = this.prescriptions ? await this.prescriptions.approvedForPatient(patient.tenantId, `synthetic:${patient.syntheticPatientId}`) : [];
        if (uploaded.length) return uploaded.flatMap((prescription) => prescription.medications.map((medication, index) => ({ category, sourceRef: `synthetic-prescription-${prescription.sourceDocumentId}-${index + 1}`, fetchedAt: now, payload: { medicationName: medication.medicationName, prescriptionDate: prescription.prescriptionDate || prescription.createdAt, instructions: medication.instructions || null, status: 'active', date: prescription.createdAt } })));
        return map(records('medications'), (x) => ({ medicationName: x.name, prescriptionDate: now, instructions: x.instructions || null, status: 'active' }));
      case HealthRecordCategory.DIAGNOSIS:
        return map(records('diagnoses'), (x) => ({ conditionName: x.name, severity: x.severity || null, onsetDate: x.onsetDate || null, status: 'active' }));
      case HealthRecordCategory.ALLERGY:
        return map(records('allergies'), (x) => ({ allergen: x.name, reactionType: x.reaction || null, severity: x.severity || null, status: 'active' }));
      case HealthRecordCategory.LAB_REPORT:
        return map(records('labResults'), (x) => ({ testName: x.name, value: x.value, unit: x.unit || null, referenceRange: x.referenceRange || null, interpretation: x.interpretation || null, observationDate: x.observationDate || now }));
      default:
        return [];
    }
  }

  private getSyntheticRecords(
    category: HealthRecordCategory,
    now: Date,
    dateRangeStart?: Date,
  ): RawHealthRecord[] {
    const allRecords = this.getAllSyntheticRecords(now);
    let records = allRecords.filter((r) => r.category === category);

    // Apply date range filter if provided
    if (dateRangeStart) {
      records = records.filter((r) => {
        const recordDate = r.payload['date'] as Date | undefined;
        if (!recordDate) return true;
        return recordDate >= dateRangeStart;
      });
    }

    return records;
  }

  /**
   * Synthetic fixture data — clearly labelled, not real patient data.
   * Provides deterministic results for all supported categories.
   */
  private getAllSyntheticRecords(now: Date): RawHealthRecord[] {
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

    return [
      // --- MEDICATIONS ---
      {
        category: HealthRecordCategory.MEDICATION,
        sourceRef: 'dev-src-med-001 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          medicationName: 'Metformin',
          dosage: '500mg',
          frequency: 'Twice daily',
          route: 'Oral',
          startDate: daysAgo(60),
          endDate: null,
          status: 'active',
          date: daysAgo(60),
        },
      },
      {
        category: HealthRecordCategory.MEDICATION,
        sourceRef: 'dev-src-med-002 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          medicationName: 'Amlodipine',
          dosage: '5mg',
          frequency: 'Once daily',
          route: 'Oral',
          startDate: daysAgo(120),
          endDate: null,
          status: 'active',
          date: daysAgo(120),
        },
      },
      {
        category: HealthRecordCategory.MEDICATION,
        sourceRef: 'dev-src-med-003-old [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          medicationName: 'Paracetamol',
          dosage: '500mg',
          frequency: 'As needed',
          route: 'Oral',
          startDate: daysAgo(200),
          endDate: daysAgo(195),
          status: 'completed',
          date: daysAgo(200),
        },
      },

      // --- PRESCRIPTIONS ---
      {
        category: HealthRecordCategory.PRESCRIPTION,
        sourceRef: 'dev-src-presc-001 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          medicationName: 'Metformin',
          prescriptionDate: daysAgo(60),
          prescribingProviderRef: 'dev-provider-ref-001',
          instructions: 'Take with meals. Monitor blood sugar weekly.',
          status: 'active',
          date: daysAgo(60),
        },
      },
      {
        category: HealthRecordCategory.PRESCRIPTION,
        sourceRef: 'dev-src-presc-002 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          medicationName: 'Amlodipine',
          prescriptionDate: daysAgo(120),
          prescribingProviderRef: 'dev-provider-ref-001',
          instructions: 'Take in the morning. Avoid grapefruit juice.',
          status: 'active',
          date: daysAgo(120),
        },
      },

      // --- DIAGNOSES ---
      {
        category: HealthRecordCategory.DIAGNOSIS,
        sourceRef: 'dev-src-diag-001 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          conditionName: 'Type 2 Diabetes Mellitus',
          severity: 'moderate',
          onsetDate: daysAgo(365),
          status: 'active',
          date: daysAgo(365),
        },
      },
      {
        category: HealthRecordCategory.DIAGNOSIS,
        sourceRef: 'dev-src-diag-002 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          conditionName: 'Essential Hypertension',
          severity: 'mild',
          onsetDate: daysAgo(300),
          status: 'active',
          date: daysAgo(300),
        },
      },

      // --- LAB REPORTS ---
      {
        category: HealthRecordCategory.LAB_REPORT,
        sourceRef: 'dev-src-lab-001 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          testName: 'HbA1c',
          value: '7.2',
          unit: '%',
          referenceRange: '4.0–5.6',
          interpretation: 'abnormal',
          observationDate: daysAgo(30),
          date: daysAgo(30),
        },
      },
      {
        category: HealthRecordCategory.LAB_REPORT,
        sourceRef: 'dev-src-lab-002 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          testName: 'Fasting Blood Glucose',
          value: '128',
          unit: 'mg/dL',
          referenceRange: '70–100',
          interpretation: 'abnormal',
          observationDate: daysAgo(30),
          date: daysAgo(30),
        },
      },
      {
        category: HealthRecordCategory.LAB_REPORT,
        sourceRef: 'dev-src-lab-003 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          testName: 'Hemoglobin',
          value: '13.5',
          unit: 'g/dL',
          referenceRange: '12.0–15.5',
          interpretation: 'normal',
          observationDate: daysAgo(30),
          date: daysAgo(30),
        },
      },
      {
        category: HealthRecordCategory.LAB_REPORT,
        sourceRef: 'dev-src-lab-004-old [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          testName: 'Complete Blood Count',
          value: 'Normal',
          unit: null,
          referenceRange: null,
          interpretation: 'normal',
          observationDate: daysAgo(365),
          date: daysAgo(365),
        },
      },

      // --- INVESTIGATIONS ---
      {
        category: HealthRecordCategory.INVESTIGATION,
        sourceRef: 'dev-src-inv-001 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          testName: 'ECG',
          value: 'Normal sinus rhythm',
          unit: null,
          referenceRange: null,
          interpretation: 'normal',
          observationDate: daysAgo(90),
          date: daysAgo(90),
        },
      },

      // --- ALLERGIES ---
      {
        category: HealthRecordCategory.ALLERGY,
        sourceRef: 'dev-src-allergy-001 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          allergen: 'Penicillin',
          reactionType: 'Rash',
          severity: 'moderate',
          status: 'active',
          date: daysAgo(500),
        },
      },
      {
        category: HealthRecordCategory.ALLERGY,
        sourceRef: 'dev-src-allergy-002 [SYNTHETIC-DEV-FIXTURE]',
        fetchedAt: now,
        payload: {
          allergen: 'Sulfonamides',
          reactionType: 'Urticaria',
          severity: 'mild',
          status: 'active',
          date: daysAgo(400),
        },
      },
    ];
  }
}
