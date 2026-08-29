import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ConfigurationService } from '../configuration/configuration.service';
import { SyntheticPatientService } from '../dev/synthetic-patient.service';
import { AdherenceStatus, MedicationService } from './medication.service';

@Controller('dev/demo/patients/:patientId/medications')
@UseGuards(AuthGuard)
export class MedicationController {
  constructor(private readonly medications: MedicationService, private readonly patients: SyntheticPatientService, private readonly config: ConfigurationService) {}
  private async ref(req: any, id: string) { const patient = await this.patients.get(req.user.tenantId, id); return `synthetic:${patient.syntheticPatientId}`; }
  @Get() async list(@Param('patientId') patientId: string, @Req() req: any) { return this.medications.list(req.user.tenantId, await this.ref(req, patientId)); }
  @Post(':medicationId/confirm') async confirm(@Param('patientId') _patientId: string, @Param('medicationId') medicationId: string, @Req() req: any) { return this.medications.confirm(req.user.tenantId, medicationId, (req['correlationId'] as string) || 'medication-confirm'); }
  @Get('adherence/events') async events(@Param('patientId') patientId: string, @Req() req: any) { return this.medications.listAdherence(req.user.tenantId, await this.ref(req, patientId)); }
  @Post(':medicationId/adherence') async record(@Param('patientId') patientId: string, @Param('medicationId') medicationId: string, @Body() body: { scheduledDate: string; scheduleSlot?: string; status: AdherenceStatus; notes?: string }, @Req() req: any) { return this.medications.recordAdherence({ tenantId: req.user.tenantId, medicationId, patientRef: await this.ref(req, patientId), scheduledDate: body.scheduledDate, scheduleSlot: body.scheduleSlot || null, status: body.status, source: 'PATIENT', notes: body.notes || null }); }
  @Get(':medicationId/adherence/prompt-eligibility/:scheduledDate/:scheduleSlot') async promptEligibility(@Param('patientId') _patientId: string, @Param('medicationId') medicationId: string, @Param('scheduledDate') scheduledDate: string, @Param('scheduleSlot') scheduleSlot: string, @Req() req: any) { const cooldownMinutes = this.config.medicationAdherenceCooldownMinutes; const alreadyConfirmed = await this.medications.hasRecentScheduleEvent(req.user.tenantId, medicationId, scheduledDate, scheduleSlot === 'none' ? null : scheduleSlot, cooldownMinutes); return { eligible: !alreadyConfirmed, cooldownMinutes, reason: alreadyConfirmed ? 'SCHEDULE_CONTEXT_ALREADY_CONFIRMED_WITHIN_COOLDOWN' : 'NO_RECENT_SCHEDULE_CONTEXT_CONFIRMATION' }; }
}
