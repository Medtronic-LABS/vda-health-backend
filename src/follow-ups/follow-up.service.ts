import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { ClinicalFollowUpAttendance } from '../database/entities/clinical-follow-up-attendance.entity';
import { Session } from '../database/entities/session.entity';
import {
  PATIENT_DATA_PROVIDER,
  PatientClinicalProfile,
  PatientDataProvider,
  ScheduledClinicalEvent,
} from '../dev/patient-data/patient-data-provider.interface';
import {
  ClinicalFollowUp,
  FollowUpAttendanceResponse,
  FollowUpDateSource,
  FollowUpListResponse,
  FollowUpStatus,
} from './follow-up.types';

interface ResolvedFollowUps {
  session: Session;
  patientRef: string;
  followUps: ClinicalFollowUp[];
}

interface NormalizedEvent {
  id: string;
  type: ClinicalFollowUp['type'];
  title: string;
  dueDate: string;
  dateSource: FollowUpDateSource;
  condition?: string;
  guidance?: string;
}

@Injectable()
export class FollowUpService {
  constructor(
    @Inject(PATIENT_DATA_PROVIDER) private readonly patientData: PatientDataProvider,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(ClinicalFollowUpAttendance)
    private readonly attendance: Repository<ClinicalFollowUpAttendance>,
  ) {}

  async listForSession(tenantId: string, sessionId: string): Promise<FollowUpListResponse> {
    const resolved = await this.resolveForSession(tenantId, sessionId);
    const timezone = (await this.patientData.getPatientByReference(tenantId, resolved.patientRef))?.timezone || 'Asia/Kolkata';
    return {
      asOfDate: this.localDate(this.now(), timezone),
      timezone,
      followUps: resolved.followUps,
    };
  }

  async recordAttendance(
    tenantId: string,
    sessionId: string,
    followUpId: string,
    attended: boolean,
  ): Promise<FollowUpAttendanceResponse> {
    const resolved = await this.resolveForSession(tenantId, sessionId);
    const requestedStatus = attended ? 'COMPLETED' : 'MISSED';
    const priorResponse = await this.attendance.findOne({
      where: { tenantId, patientRef: resolved.patientRef, eventId: followUpId },
    });
    if (priorResponse) {
      if (priorResponse.attendanceStatus === requestedStatus) {
        return this.attendanceResponse(followUpId, requestedStatus);
      }
      throw new ConflictException('FOLLOW_UP_ATTENDANCE_ALREADY_RECORDED');
    }
    const followUp = resolved.followUps.find((item) => item.id === followUpId && item.requiresAttendanceCheck);
    if (!followUp) {
      throw new BadRequestException('FOLLOW_UP_ATTENDANCE_NOT_ELIGIBLE');
    }

    const attendanceStatus = requestedStatus;
    await this.attendance.save(this.attendance.create({
      tenantId,
      patientRef: resolved.patientRef,
      eventId: followUp.id,
      dueDate: followUp.dueDate,
      dateSource: followUp.dateSource,
      attendanceStatus,
      respondedAt: this.now(),
    }));

    return this.attendanceResponse(followUpId, attendanceStatus, followUp.guidance);
  }

  /** Kept protected to make deterministic date-boundary validation possible without altering runtime behavior. */
  protected now(): Date {
    return new Date();
  }

  private async resolveForSession(tenantId: string, sessionId: string): Promise<ResolvedFollowUps> {
    const session = await this.sessions.findOne({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');

    const patient = await this.patientData.getPatientByReference(tenantId, session.subjectAbhaRef);
    if (!patient) throw new NotFoundException('PATIENT_CONTEXT_NOT_FOUND');

    const timezone = patient.timezone || 'Asia/Kolkata';
    const today = this.localDate(this.now(), timezone);
    const events = this.normalizeEvents(patient.clinicalProfile, today);
    const records = await this.attendance.find({
      where: { tenantId, patientRef: session.subjectAbhaRef },
    });
    const attendanceByEvent = new Map(records.map((record) => [this.attendanceKey(record.eventId, record.dueDate), record]));
    const followUps = events
      .map((event) => this.toFollowUp(event, today, attendanceByEvent.get(this.attendanceKey(event.id, event.dueDate))))
      .filter((item): item is ClinicalFollowUp => item !== null)
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.title.localeCompare(right.title));

    return { session, patientRef: session.subjectAbhaRef, followUps };
  }

  private normalizeEvents(profile: PatientClinicalProfile, today: string): NormalizedEvent[] {
    const explicit = (profile.scheduledEvents || [])
      .map((event) => this.normalizeExplicitEvent(event))
      .filter((event): event is NormalizedEvent => event !== null);
    const derived = this.deriveThirtyDayReview(profile, today, explicit);
    return derived ? [...explicit, derived] : explicit;
  }

  private normalizeExplicitEvent(event: ScheduledClinicalEvent): NormalizedEvent | null {
    const dueDate = this.normalizedDate(event.dueDate);
    if (!dueDate || !event.title.trim()) return null;
    const type = event.type;
    const sourceIdentity = event.id || `${type}|${event.title}|${dueDate}|${event.condition || ''}|${event.source || ''}`;
    return {
      id: this.opaqueId(sourceIdentity),
      type,
      title: event.title.trim(),
      dueDate,
      dateSource: 'EXPLICIT',
      condition: event.condition?.trim() || undefined,
      guidance: event.guidance?.trim() || undefined,
    };
  }

  private deriveThirtyDayReview(
    profile: PatientClinicalProfile,
    today: string,
    explicit: NormalizedEvent[],
  ): NormalizedEvent | null {
    const completed = (profile.encounters || [])
      .map((encounter) => ({
        status: this.text(encounter.status).toLowerCase(),
        date: this.normalizedDate(encounter.end) || this.normalizedDate(encounter.start),
        type: this.text(encounter.type),
      }))
      .filter((encounter) => encounter.date && ['finished', 'completed', 'closed'].includes(encounter.status) && encounter.date <= today)
      .sort((left, right) => right.date!.localeCompare(left.date!));
    const latest = completed[0];
    if (!latest?.date) return null;

    const dueDate = this.addDays(latest.date, 30);
    const condition = latest.type || undefined;
    const hasExplicitReview = explicit.some((event) =>
      ['CLINICAL_REVIEW', 'CHECKUP'].includes(event.type)
      && (!event.condition || !condition || event.condition.toLowerCase() === condition.toLowerCase()),
    );
    if (hasExplicitReview) return null;

    return {
      id: this.opaqueId(`derived-30-day|${latest.date}|${condition || ''}`),
      type: 'CLINICAL_REVIEW',
      title: condition ? `${condition} follow-up` : 'Clinical follow-up',
      dueDate,
      dateSource: 'DERIVED_30_DAY',
      condition,
    };
  }

  private toFollowUp(
    event: NormalizedEvent,
    today: string,
    record?: ClinicalFollowUpAttendance,
  ): ClinicalFollowUp | null {
    const daysUntil = this.daysBetween(today, event.dueDate);
    if (daysUntil === -1 && !record) {
      return { ...event, daysUntil, status: 'ATTENDANCE_CHECK', attendanceStatus: 'PENDING', requiresAttendanceCheck: true };
    }
    if (daysUntil < 0 || daysUntil > 7) return null;
    const status: FollowUpStatus = daysUntil === 0 ? 'DUE_TODAY' : daysUntil === 1 ? 'DUE_TOMORROW' : 'UPCOMING';
    return {
      ...event,
      daysUntil,
      status,
      attendanceStatus: record?.attendanceStatus || 'PENDING',
      requiresAttendanceCheck: false,
    };
  }

  private localDate(date: Date, timezone: string): string {
    try {
      const fields = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date);
      const part = (type: string) => fields.find((field) => field.type === type)?.value;
      const year = part('year');
      const month = part('month');
      const day = part('day');
      if (year && month && day) return `${year}-${month}-${day}`;
    } catch {
      // A malformed source timezone falls back to the configured India-local development default.
    }
    return this.localDate(date, 'Asia/Kolkata');
  }

  private normalizedDate(value: unknown): string | null {
    const candidate = typeof value === 'string' ? value.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
    const [year, month, day] = candidate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? candidate : null;
  }

  private addDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const result = new Date(Date.UTC(year, month - 1, day + days));
    return result.toISOString().slice(0, 10);
  }

  private daysBetween(from: string, to: string): number {
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    return Math.round((toMs - fromMs) / 86_400_000);
  }

  private opaqueId(sourceIdentity: string): string {
    return `cfu_${createHash('sha256').update(sourceIdentity).digest('hex').slice(0, 24)}`;
  }

  private attendanceKey(eventId: string, dueDate: string): string {
    return `${eventId}|${dueDate}`;
  }

  private attendanceResponse(
    followUpId: string,
    attendanceStatus: 'COMPLETED' | 'MISSED',
    guidance?: string,
  ): FollowUpAttendanceResponse {
    return {
      followUpId,
      attendanceStatus,
      message: attendanceStatus === 'COMPLETED'
        ? 'Thanks for confirming your clinical follow-up. Please continue following the advice given during your visit.'
        : guidance || 'Your follow-up was missed. Please contact your care team or usual facility to arrange the next appropriate review.',
    };
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
