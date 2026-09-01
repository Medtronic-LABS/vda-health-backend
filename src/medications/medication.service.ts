import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { MedicationAdherenceEvent } from '../database/entities/medication-adherence-event.entity';
import { Medication } from '../database/entities/medication.entity';
import { Session } from '../database/entities/session.entity';
import { SyntheticPatientService } from '../dev/synthetic-patient.service';
import { ConfigurationService } from '../configuration/configuration.service';

export type AdherenceStatus = 'TAKEN' | 'MISSED' | 'SKIPPED' | 'UNKNOWN';

@Injectable()
export class MedicationService {
  constructor(
    @InjectRepository(Medication) private readonly medications: Repository<Medication>,
    @InjectRepository(MedicationAdherenceEvent) private readonly adherenceEvents: Repository<MedicationAdherenceEvent>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly syntheticPatients: SyntheticPatientService,
    private readonly config: ConfigurationService,
    private readonly auditService: AuditService,
  ) {}
  async createCandidates(tenantId: string, patientRef: string, prescriptionId: string, items: Array<Record<string, string | null>>): Promise<Medication[]> { return Promise.all(items.filter((item) => Boolean(item.medicationName)).map((item) => this.medications.save(this.medications.create({ tenantId, patientRef, sourcePrescriptionId: prescriptionId, name: item.medicationName!.trim(), normalizedName: item.medicationName!.trim().toLowerCase(), strength: item.strength || null, dosage: item.dosage || null, frequency: item.frequency || null, route: item.route || null, timing: item.timing || null, duration: item.duration || null, instructions: item.instructions || null, status: 'INACTIVE', verificationStatus: 'VALIDATION_REQUIRED', sourceType: 'PRESCRIPTION', sourceReference: prescriptionId })))); }
  async list(tenantId: string, patientRef?: string): Promise<Medication[]> { return this.medications.find({ where: patientRef ? { tenantId, patientRef } : { tenantId }, order: { createdAt: 'DESC' } }); }
  async activeForPatient(tenantId: string, patientRef: string): Promise<Medication[]> { return this.medications.find({ where: { tenantId, patientRef, verificationStatus: 'CONFIRMED', status: 'ACTIVE' }, order: { createdAt: 'DESC' } }); }
  async confirm(tenantId: string, medicationId: string, correlationId?: string): Promise<Medication> {
    const corrId = correlationId || 'medication-confirm';
    return this.medications.manager.transaction(async (manager) => {
      const medicationsRepo = manager.getRepository(Medication);
      const medication = await medicationsRepo.findOne({ where: { id: medicationId, tenantId } });
      if (!medication) throw new NotFoundException('MEDICATION_NOT_FOUND');
      if (medication.verificationStatus === 'REJECTED' || medication.status === 'REJECTED') {
        throw new BadRequestException('REJECTED_MEDICATION_REQUIRES_NEW_EXPLICIT_CONFIRMATION_FLOW');
      }
      if (medication.verificationStatus !== 'VALIDATION_REQUIRED' && medication.verificationStatus !== 'CONFIRMED') {
        throw new BadRequestException('INVALID_MEDICATION_CONFIRMATION_TRANSITION');
      }

      // Check if there is an existing active medication with the same identity (normalizedName)
      const existingActive = await medicationsRepo.findOne({
        where: {
          tenantId,
          patientRef: medication.patientRef,
          normalizedName: medication.normalizedName || medication.name.trim().toLowerCase(),
          status: 'ACTIVE',
          verificationStatus: 'CONFIRMED'
        }
      });

      if (existingActive && existingActive.id !== medication.id) {
        // Deactivate old active medication
        existingActive.status = 'INACTIVE';
        await medicationsRepo.save(existingActive);

        // Audit log of the dose change transition
        await this.auditService.logEvent({
          tenantId,
          subjectAbhaRef: medication.patientRef,
          actingPrincipal: 'medication-service',
          correlationId: corrId,
          action: 'medication_dose_changed',
          entityName: 'medication',
          entityId: medication.id,
          details: {
            medicationName: medication.name,
            current: {
              medicationId: existingActive.id,
              strength: existingActive.strength,
              dosage: existingActive.dosage,
              frequency: existingActive.frequency,
              status: 'INACTIVE',
            },
            new: {
              medicationId: medication.id,
              strength: medication.strength,
              dosage: medication.dosage,
              frequency: medication.frequency,
              status: 'ACTIVE',
            }
          }
        });
      } else {
        // Audit log of new medication confirmation
        await this.auditService.logEvent({
          tenantId,
          subjectAbhaRef: medication.patientRef,
          actingPrincipal: 'medication-service',
          correlationId: corrId,
          action: 'medication_confirmed',
          entityName: 'medication',
          entityId: medication.id,
          details: {
            medicationName: medication.name,
            strength: medication.strength,
            dosage: medication.dosage,
            frequency: medication.frequency,
          }
        });
      }

      medication.verificationStatus = 'CONFIRMED';
      medication.status = 'ACTIVE';
      return medicationsRepo.save(medication);
    });
  }
  async confirmPrescription(tenantId: string, prescriptionId: string): Promise<Medication[]> { const candidates = await this.medications.find({ where: { tenantId, sourcePrescriptionId: prescriptionId } }); return Promise.all(candidates.map((candidate) => this.confirm(tenantId, candidate.id))); }
  async recordAdherence(input: { tenantId: string; medicationId: string; patientRef: string; scheduledDate: string; scheduleSlot?: string | null; status: AdherenceStatus; source: 'PATIENT' | 'CAREGIVER' | 'CLINICIAN' | 'SYSTEM'; notes?: string | null }): Promise<MedicationAdherenceEvent> { const medication = await this.medications.findOne({ where: { id: input.medicationId, tenantId: input.tenantId, patientRef: input.patientRef, verificationStatus: 'CONFIRMED', status: 'ACTIVE' } }); if (!medication) throw new BadRequestException('ADHERENCE_REQUIRES_CONFIRMED_ACTIVE_MEDICATION'); return this.adherenceEvents.save(this.adherenceEvents.create({ ...input, scheduleSlot: input.scheduleSlot || null, notes: input.notes || null, confirmedAt: new Date() })); }
  async listAdherence(tenantId: string, patientRef?: string): Promise<MedicationAdherenceEvent[]> { return this.adherenceEvents.find({ where: patientRef ? { tenantId, patientRef } : { tenantId }, order: { confirmedAt: 'DESC' } }); }
  async hasRecentScheduleEvent(tenantId: string, medicationId: string, scheduledDate: string, scheduleSlot: string | null, cooldownMinutes: number): Promise<boolean> { return this.adherenceEvents.exists({ where: { tenantId, medicationId, scheduledDate, scheduleSlot: scheduleSlot ? scheduleSlot : IsNull(), confirmedAt: MoreThanOrEqual(new Date(Date.now() - cooldownMinutes * 60_000)) } }); }
  async handleConversation(sessionId: string, tenantId: string, input: string, language: string): Promise<{ summary: string; medicationId?: string; adherenceEvent?: MedicationAdherenceEvent; intent: string } | null> { const session = await this.sessions.findOne({ where: { id: sessionId, tenantId } }); if (!session) return null; const active = await this.activeForPatient(tenantId, session.subjectAbhaRef); const lower = input.toLowerCase(); const state = (session.medicationState || {}) as { currentMedicationId?: string; currentMedicationName?: string; pendingAdherence?: { medicationId: string; scheduleSlot: string | null } }; const explicitlyNamed = active.find((medication) => lower.includes(medication.name.toLowerCase())); const refersToCurrent = /इसे|इस दवाई|यह दवा|this medicine|it\b/i.test(input); const medication = explicitlyNamed || (refersToCurrent ? active.find((item) => item.id === state.currentMedicationId) : undefined); const isTaken = /ले ली|ले लिया|ले लिया है|ले चुका|took|taken/i.test(input); const isMissed = /भूल गया|भूल गई|नहीं ली|missed|forgot/i.test(input); const slot = /सुबह|morning/i.test(input) ? 'morning' : /शाम|evening|night|रात/i.test(input) ? 'evening' : null; const profile = await this.syntheticPatients.getByReference(tenantId, session.subjectAbhaRef); const timeZone = profile?.timezone || 'Asia/Kolkata'; const date = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    if (isTaken && /[?？]\s*$/.test(input) && medication) { const alreadyConfirmed = await this.hasRecentScheduleEvent(tenantId, medication.id, date, slot, this.config.medicationAdherenceCooldownMinutes); if (alreadyConfirmed) return { summary: language === 'hi' ? `आज की ${medication.name} की इस खुराक की पुष्टि पहले ही दर्ज है।` : `Today's ${medication.name} dose has already been confirmed.`, medicationId: medication.id, intent: 'ADHERENCE_QUERY' }; session.medicationState = { ...state, currentMedicationId: medication.id, currentMedicationName: medication.name, pendingAdherence: { medicationId: medication.id, scheduleSlot: slot } }; await this.sessions.save(session); return { summary: language === 'hi' ? `कृपया पुष्टि करें: क्या आपने आज की ${medication.name} की खुराक ली है?` : `Please confirm: did you take today's ${medication.name} dose?`, medicationId: medication.id, intent: 'ADHERENCE_QUERY' }; }
    const confirmation = /^(हाँ|हां|yes|y)$/i.test(input.trim()) ? 'TAKEN' : /^(नहीं|नही|no|n)$/i.test(input.trim()) ? 'MISSED' : null;
    if (confirmation && state.pendingAdherence) { const pendingMedication = active.find((item) => item.id === state.pendingAdherence!.medicationId); if (!pendingMedication) return null; const alreadyConfirmed = await this.hasRecentScheduleEvent(tenantId, pendingMedication.id, date, state.pendingAdherence.scheduleSlot, this.config.medicationAdherenceCooldownMinutes); if (alreadyConfirmed) { await this.saveState(session, pendingMedication, 'ADHERENCE_CONFIRMATION', input); return { summary: language === 'hi' ? `आज की ${pendingMedication.name} की इस खुराक की पुष्टि पहले ही दर्ज है।` : `Today's ${pendingMedication.name} dose has already been confirmed.`, medicationId: pendingMedication.id, intent: 'ADHERENCE_QUERY' }; } const event = await this.recordAdherence({ tenantId, medicationId: pendingMedication.id, patientRef: session.subjectAbhaRef, scheduledDate: date, scheduleSlot: state.pendingAdherence.scheduleSlot, status: confirmation, source: 'PATIENT' }); await this.saveState(session, pendingMedication, 'ADHERENCE_CONFIRMATION', input, event); return { summary: confirmation === 'TAKEN' ? (language === 'hi' ? `बहुत अच्छा। आज की ${pendingMedication.name} की खुराक लेने की पुष्टि हो गई।` : `Confirmed: today's ${pendingMedication.name} dose was taken.`) : (language === 'hi' ? `${pendingMedication.name} को मिस्ड के रूप में दर्ज किया गया है। अगली खुराक के लिए पर्चे या डॉक्टर के निर्देशों का पालन करें; अतिरिक्त खुराक न लें।` : `${pendingMedication.name} was recorded as missed. Follow the prescription or clinician's instructions for the next dose; do not take an extra dose.`), medicationId: pendingMedication.id, adherenceEvent: event, intent: 'ADHERENCE_QUERY' }; }
    if (isTaken || isMissed) { if (!medication) return { summary: language === 'hi' ? 'आप किस दवा की खुराक लेना भूल गए हैं?' : 'Which medication dose did you miss?', intent: 'ADHERENCE_QUERY' }; const alreadyConfirmed = await this.hasRecentScheduleEvent(tenantId, medication.id, date, slot, this.config.medicationAdherenceCooldownMinutes); if (alreadyConfirmed) return { summary: language === 'hi' ? `आज की ${medication.name} की इस खुराक की पुष्टि पहले ही दर्ज है।` : `Today's ${medication.name} dose has already been confirmed.`, medicationId: medication.id, intent: 'ADHERENCE_QUERY' }; const event = await this.recordAdherence({ tenantId, medicationId: medication.id, patientRef: session.subjectAbhaRef, scheduledDate: date, scheduleSlot: slot, status: isTaken ? 'TAKEN' : 'MISSED', source: 'PATIENT' }); await this.saveState(session, medication, 'ADHERENCE_CONFIRMATION', input, event); return { summary: isTaken ? (language === 'hi' ? `बहुत अच्छा। आज की ${medication.name} की खुराक लेने की पुष्टि हो गई।` : `Confirmed: today's ${medication.name} dose was taken.`) : (language === 'hi' ? `ठीक है। ${medication.name} को मिस्ड के रूप में दर्ज किया गया है। अगली खुराक के लिए अपने पर्चे या डॉक्टर के निर्देशों का पालन करें; अतिरिक्त खुराक न लें।` : `${medication.name} was recorded as missed. Follow the prescription or clinician's instructions for the next dose; do not take an extra dose.`), medicationId: medication.id, adherenceEvent: event, intent: 'ADHERENCE_QUERY' }; }
    if (/मेरी.*दवाई|कौन सी दवाई|current medication|what medicine/i.test(input)) { if (!active.length) return null; const primary = active[0]; await this.saveState(session, primary, 'MEDICATION_LIST', input); return { summary: language === 'hi' ? `आपके रिकॉर्ड में ${active.map((item) => `${item.name}${item.strength ? ` ${item.strength}` : ''}${item.frequency ? `, ${item.frequency}` : ''}`).join('; ')} है।` : `Your record lists ${active.map((item) => `${item.name}${item.strength ? ` ${item.strength}` : ''}${item.frequency ? `, ${item.frequency}` : ''}`).join('; ')}.`, medicationId: primary.id, intent: 'MEDICATION_QUERY' }; }
    if ((refersToCurrent || explicitlyNamed) && medication && /कब|time|when/i.test(input)) { await this.saveState(session, medication, 'MEDICATION_TIMING', input); return { summary: medication.timing ? (language === 'hi' ? `${medication.name} के लिए दर्ज समय: ${medication.timing}।` : `Recorded timing for ${medication.name}: ${medication.timing}.`) : medication.frequency ? (language === 'hi' ? `${medication.name} दिन में ${medication.frequency} लेने के लिए लिखी गई है। पर्चे में खास समय नहीं दिया गया है।` : `${medication.name} is prescribed ${medication.frequency}. The prescription does not specify an exact time.`) : (language === 'hi' ? `${medication.name} के लिए समय उपलब्ध नहीं है।` : `No timing is available for ${medication.name}.`), medicationId: medication.id, intent: 'MEDICATION_QUERY' }; }
    if (explicitlyNamed) { await this.saveState(session, explicitlyNamed, 'MEDICATION_REFERENCE', input); }
    return null; }
  private async saveState(session: Session, medication: Medication, lastMedicationIntent: string, lastMedicationQuestion: string, adherenceEvent?: MedicationAdherenceEvent): Promise<void> { session.medicationState = { currentMedicationId: medication.id, currentMedicationName: medication.name, lastMedicationIntent, lastMedicationQuestion, ...(adherenceEvent ? { lastAdherenceEvent: { id: adherenceEvent.id, status: adherenceEvent.status, confirmedAt: adherenceEvent.confirmedAt.toISOString() } } : {}) }; await this.sessions.save(session); }
}
