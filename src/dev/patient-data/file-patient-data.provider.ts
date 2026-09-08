import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { ConfigurationService } from '../../configuration/configuration.service';
import {
  PatientClinicalProfile,
  PatientDataProvider,
  PatientDataRecord,
  PatientDataSummary,
} from './patient-data-provider.interface';

type JsonObject = Record<string, unknown>;

interface LoadedDataset {
  patients: Map<string, PatientDataRecord>;
  summaries: PatientDataSummary[];
}

/**
 * Local prototype adapter for Denis's FHIR bundle export. The adapter owns all
 * file parsing; callers only see the selected patient's authorized profile.
 */
@Injectable()
export class FilePatientDataProvider implements PatientDataProvider {
  private readonly logger = new Logger(FilePatientDataProvider.name);
  private datasetPromise?: Promise<LoadedDataset>;

  constructor(private readonly config: ConfigurationService) {}

  async getPatients(_tenantId: string): Promise<PatientDataSummary[]> {
    return (await this.load()).summaries;
  }

  async getPatient(_tenantId: string, patientId: string): Promise<PatientDataRecord | null> {
    return (await this.load()).patients.get(patientId) ?? null;
  }

  async getClinicalContext(tenantId: string, patientId: string): Promise<PatientClinicalProfile | null> {
    return (await this.getPatient(tenantId, patientId))?.clinicalProfile ?? null;
  }

  async getPatientByReference(tenantId: string, subjectReference: string): Promise<PatientDataRecord | null> {
    if (!subjectReference.startsWith('local-file:')) return null;
    return this.getPatient(tenantId, subjectReference.slice('local-file:'.length));
  }

  private async load(): Promise<LoadedDataset> {
    if (!this.datasetPromise) this.datasetPromise = this.loadDataset();
    return this.datasetPromise;
  }

  private async loadDataset(): Promise<LoadedDataset> {
    const summaryPath = this.config.localPatientSummaryPath;
    const bundlesPath = this.config.localPatientBundlesPath;
    if (!summaryPath || !bundlesPath) {
      this.logger.warn('Local patient dataset is not configured; patient selection is unavailable.');
      return { patients: new Map(), summaries: [] };
    }

    try {
      const [summaryJson, bundlesJson] = await Promise.all([
        readFile(summaryPath, 'utf8'),
        readFile(bundlesPath, 'utf8'),
      ]);
      const summaries = this.asArray(JSON.parse(summaryJson));
      const bundles = this.asArray(JSON.parse(bundlesJson));
      const bundlesById = new Map<string, JsonObject>();
      for (const bundle of bundles) {
        const patientResource = this.asArray(bundle.entry)
          .map((entry) => this.object(entry.resource))
          .find((resource) => this.text(resource.resourceType) === 'Patient');
        const id = patientResource ? this.text(patientResource.id) : '';
        if (id) bundlesById.set(id, bundle);
      }

      const patients = new Map<string, PatientDataRecord>();
      for (const summary of summaries) {
        const id = this.text(summary.id);
        if (!id || patients.has(id)) continue;
        const bundle = bundlesById.get(id);
        if (!bundle) continue;
        const patient = this.toPatient(summary, bundle);
        patients.set(id, patient);
      }
      const patientSummaries = [...patients.values()]
        .map(({ clinicalProfile: _profile, ...summary }) => summary)
        .sort((left, right) => left.name.localeCompare(right.name));
      this.logger.log(`Loaded ${patients.size} local prototype patient records.`);
      return { patients, summaries: patientSummaries };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Local patient dataset could not be loaded: ${reason}`);
      return { patients: new Map(), summaries: [] };
    }
  }

  private toPatient(summary: JsonObject, bundle: JsonObject): PatientDataRecord {
    const profile = this.profileFromBundle(bundle);
    return {
      id: this.text(summary.id),
      name: this.text(summary.name, 'Local patient'),
      age: this.number(summary.age),
      gender: this.text(summary.gender),
      language: this.text(summary.language, 'en'),
      state: this.text(summary.state),
      district: this.text(summary.district),
      source: 'local-file',
      clinicalProfile: profile,
    };
  }

  private profileFromBundle(bundle: JsonObject): PatientClinicalProfile {
    const entries = this.asArray(bundle.entry).map((entry) => this.object(entry.resource));
    const profile: PatientClinicalProfile = {
      diagnoses: [], medications: [], labResults: [], allergies: [], prescriptions: [], carePlans: [], encounters: [], scheduledEvents: [],
    };
    for (const resource of entries) {
      switch (this.text(resource.resourceType)) {
        case 'Condition': {
          const name = this.codeDisplay(resource.code);
          if (name) profile.diagnoses.push({ name, status: this.codeDisplay(resource.clinicalStatus) || 'active', onsetDate: this.date(resource.onsetDateTime) });
          break;
        }
        case 'MedicationStatement': {
          const name = this.codeDisplay(resource.medicationCodeableConcept);
          const dosage = this.dosage(resource);
          if (name) profile.medications.push({ name, dosage, frequency: dosage, route: null, status: this.text(resource.status, 'active') });
          break;
        }
        case 'Observation': {
          const name = this.codeDisplay(resource.code);
          const quantity = this.object(resource.valueQuantity);
          const value = quantity.value;
          if (name && (typeof value === 'string' || typeof value === 'number')) {
            // Preserve the source label as provenance; it is never promoted to
            // a governed clinical interpretation without an approved rule.
            profile.labResults.push({ name, value: String(value), unit: this.text(quantity.unit) || this.text(quantity.code), sourceInterpretation: this.interpretation(resource), observationDate: this.date(resource.effectiveDateTime) });
          }
          break;
        }
        case 'CarePlan': {
          const activities = this.asArray(resource.activity)
            .map((activity) => this.text(this.object(activity.detail).description))
            .filter((value): value is string => Boolean(value));
          profile.carePlans.push({ category: this.codeDisplay(this.asArray(resource.category)[0]), status: this.text(resource.status), activities });
          for (const activity of this.asArray(resource.activity)) {
            const detail = this.object(activity.detail);
            const dueDate = this.date(this.object(detail.scheduledPeriod).start) || this.date(this.asArray(this.object(detail.scheduledTiming).event)[0]);
            if (dueDate) profile.scheduledEvents.push({ id: this.text(detail.id) || undefined, type: 'CLINICAL_REVIEW', title: this.text(detail.description, 'Clinical follow-up'), dueDate, condition: this.codeDisplay(this.asArray(resource.category)[0]) || undefined, source: 'FHIR_CARE_PLAN' });
          }
          break;
        }
        case 'Appointment': {
          const dueDate = this.date(resource.start);
          if (dueDate) profile.scheduledEvents.push({ id: this.text(resource.id) || undefined, type: 'CHECKUP', title: this.codeDisplay(this.asArray(resource.serviceType)[0]) || 'Clinical follow-up', dueDate, source: 'FHIR_APPOINTMENT' });
          break;
        }
        case 'ServiceRequest': {
          const dueDate = this.date(resource.occurrenceDateTime) || this.date(this.object(resource.occurrencePeriod).start);
          if (dueDate) profile.scheduledEvents.push({ id: this.text(resource.id) || undefined, type: 'LAB_REVIEW', title: this.codeDisplay(resource.code) || 'Clinical investigation review', dueDate, source: 'FHIR_SERVICE_REQUEST' });
          break;
        }
        case 'Encounter': {
          const type = this.codeDisplay(this.asArray(resource.type)[0]) || this.text(this.object(resource.class).display);
          const status = this.text(resource.status);
          const start = this.date(this.object(resource.period).start);
          const end = this.date(this.object(resource.period).end);
          profile.encounters.push({ type, status, start, end });
          if (start && ['planned', 'booked', 'arrived'].includes(status.toLowerCase())) {
            profile.scheduledEvents.push({ id: this.text(resource.id) || undefined, type: 'CHECKUP', title: type || 'Clinical follow-up', dueDate: start, source: 'FHIR_ENCOUNTER' });
          }
          break;
        }
      }
    }
    return profile;
  }

  private asArray(value: unknown): JsonObject[] {
    return Array.isArray(value) ? value.map((item) => this.object(item)) : [];
  }

  private object(value: unknown): JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  }

  private text(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value.trim() : fallback;
  }

  private number(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private codeDisplay(value: unknown): string {
    const object = this.object(value);
    const coding = this.object(this.asArray(object.coding)[0]);
    return this.text(object.text) || this.text(coding.display) || this.text(coding.code);
  }

  private dosage(resource: JsonObject): string | null {
    const dosage = this.object(this.asArray(resource.dosage)[0]);
    return this.text(dosage.text) || null;
  }

  private interpretation(resource: JsonObject): string | null {
    const interpretation = this.object(this.asArray(resource.interpretation)[0]);
    return this.codeDisplay(interpretation) || null;
  }

  private date(value: unknown): string | null {
    return this.text(value) || null;
  }
}
