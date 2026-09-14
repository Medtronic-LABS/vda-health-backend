import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HostIdentity } from '../auth/host-identity.context';
import { Prescription } from '../database/entities/prescription.entity';
import { Session } from '../database/entities/session.entity';
import { RedisService } from '../redis/redis.service';
import { RefreshPrescriptionSessionContextDto } from './dto/refresh-prescription-session-context.dto';

export type SanitizedPrescriptionMedicine = {
  name: string;
  strength?: string;
  frequency?: string;
  timingInstruction?: string;
  administrationInstruction?: string;
};
export type SanitizedPrescriptionReminder = { medicineName: string; reminderTimes: string[] };
export type SanitizedPrescriptionInvestigation = { name: string };

/** Server-side only. The entire object is never sent to Gemini. */
export type SanitizedPrescriptionSessionContext = {
  medicines: SanitizedPrescriptionMedicine[];
  reminders: SanitizedPrescriptionReminder[];
  investigations: SanitizedPrescriptionInvestigation[];
  lastReferencedMedicine?: string;
  lastReferencedInvestigation?: string;
};

@Injectable()
export class PrescriptionSessionContextService {
  private static readonly TTL_SECONDS = 4 * 60 * 60;
  private static readonly keyPrefix = 'vda:prescription-session-context:';
  private static readonly piiPattern = /(?:\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{10,16}\b|\b(?:abha|phone|mobile|email|address|pincode)\b)/i;

  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Prescription) private readonly prescriptions: Repository<Prescription>,
    private readonly redis: RedisService,
  ) {}

  async refresh(sessionId: string, identity: HostIdentity, dto: RefreshPrescriptionSessionContextDto): Promise<{ medicineCount: number; reminderCount: number; investigationCount: number }> {
    const session = await this.sessions.findOne({ where: { id: sessionId, tenantId: identity.tenantId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    if (session.externalId !== identity.externalId || session.status !== 'ACTIVE') throw new ForbiddenException('TENANT_ACCESS_DENIED');

    const prescription = await this.prescriptions.findOne({
      // The uploaded prescription remains tenant- and patient-bound. It may
      // have been uploaded in an earlier VDA session, then selected locally as
      // the active confirmed prescription for this new session.
      where: { id: dto.prescription_id, tenantId: identity.tenantId, patientRef: session.subjectAbhaRef },
    });
    if (!prescription || !['EXTRACTED', 'APPROVED'].includes(prescription.extractionStatus)) {
      throw new BadRequestException('ACTIVE_CONFIRMED_PRESCRIPTION_REQUIRED');
    }

    const previous = await this.get(sessionId);
    const medicines = (prescription.medications || []).map((medicine) => this.toMedicine(medicine));
    const investigations = (prescription.investigations || []).map((investigation) => this.toInvestigation(investigation));
    const medicineByName = new Map(medicines.map((medicine) => [this.normalize(medicine.name), medicine.name]));
    const previousInvestigation = previous?.lastReferencedInvestigation;
    const context: SanitizedPrescriptionSessionContext = {
      medicines,
      reminders: this.toReminders(dto.reminders || [], medicineByName),
      investigations,
      ...(previous?.lastReferencedMedicine && medicineByName.has(this.normalize(previous.lastReferencedMedicine))
        ? { lastReferencedMedicine: medicineByName.get(this.normalize(previous.lastReferencedMedicine)) }
        : {}),
      ...(previousInvestigation && investigations.some((item) => this.normalize(item.name) === this.normalize(previousInvestigation))
        ? { lastReferencedInvestigation: previousInvestigation }
        : {}),
    };
    await this.redis.set(this.key(sessionId), JSON.stringify(context), PrescriptionSessionContextService.TTL_SECONDS);
    return { medicineCount: medicines.length, reminderCount: context.reminders.length, investigationCount: investigations.length };
  }

  async get(sessionId: string): Promise<SanitizedPrescriptionSessionContext | null> {
    const stored = await this.redis.get(this.key(sessionId));
    if (!stored) return null;
    try {
      const context = JSON.parse(stored) as SanitizedPrescriptionSessionContext;
      return Array.isArray(context.medicines) && Array.isArray(context.reminders) && Array.isArray(context.investigations) ? context : null;
    } catch {
      return null;
    }
  }

  async setLastReferencedMedicine(sessionId: string, medicineName: string): Promise<void> {
    const context = await this.get(sessionId);
    const medicine = context?.medicines.find((item) => this.normalize(item.name) === this.normalize(medicineName));
    if (!context || !medicine) return;
    context.lastReferencedMedicine = medicine.name;
    await this.redis.set(this.key(sessionId), JSON.stringify(context), PrescriptionSessionContextService.TTL_SECONDS);
  }

  async setLastReferencedInvestigation(sessionId: string, investigationName: string): Promise<void> {
    const context = await this.get(sessionId);
    const investigation = context?.investigations.find((item) => this.normalize(item.name) === this.normalize(investigationName));
    if (!context || !investigation) return;
    context.lastReferencedInvestigation = investigation.name;
    await this.redis.set(this.key(sessionId), JSON.stringify(context), PrescriptionSessionContextService.TTL_SECONDS);
  }

  private toMedicine(source: Record<string, string | null>): SanitizedPrescriptionMedicine {
    return {
      name: this.requiredText(source.normalizedName || source.medicationName, 'MEDICINE_NAME_UNSAFE'),
      ...this.optionalText(source.strength, 'strength'),
      ...this.optionalText(source.frequency, 'frequency'),
      ...this.optionalText(source.timing, 'timingInstruction'),
      ...this.optionalText(source.instructions, 'administrationInstruction'),
    };
  }

  private toInvestigation(source: Record<string, string | null>): SanitizedPrescriptionInvestigation {
    return { name: this.requiredText(source.normalizedName || source.rawName, 'INVESTIGATION_NAME_UNSAFE') };
  }

  private toReminders(source: Array<{ medicine_name: string; reminder_times: string[] }>, medicineByName: Map<string, string>): SanitizedPrescriptionReminder[] {
    const seen = new Set<string>();
    return source.flatMap((reminder) => {
      const medicineName = medicineByName.get(this.normalize(reminder.medicine_name));
      if (!medicineName || seen.has(this.normalize(medicineName))) return [];
      seen.add(this.normalize(medicineName));
      return [{ medicineName, reminderTimes: [...new Set(reminder.reminder_times)].sort() }];
    });
  }

  private requiredText(value: unknown, code: string): string {
    const text = this.cleanText(value);
    if (!text) throw new BadRequestException(code);
    return text;
  }

  private optionalText(value: unknown, key: keyof Omit<SanitizedPrescriptionMedicine, 'name'>): Partial<SanitizedPrescriptionMedicine> {
    const text = value == null || value === '' ? null : this.cleanText(value);
    if (value != null && value !== '' && !text) throw new BadRequestException('PRESCRIPTION_CONTEXT_UNSAFE_VALUE');
    return text ? { [key]: text } : {};
  }

  private cleanText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 120 || /[\u0000-\u001F\u007F]/.test(text) || PrescriptionSessionContextService.piiPattern.test(text)) return null;
    return text;
  }

  private normalize(value: string): string {
    return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  private key(sessionId: string): string {
    return `${PrescriptionSessionContextService.keyPrefix}${sessionId}`;
  }
}
