import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Prescription } from '../database/entities/prescription.entity';
import { MultiFormatParserService } from '../knowledge/ingestion/multi-format-parser.service';
import { IAiProvider } from '../ai/interfaces/ai-provider.interface';

@Injectable()
export class PrescriptionService {
  private readonly logger = new Logger(PrescriptionService.name);
  constructor(@InjectRepository(Prescription) private readonly prescriptions: Repository<Prescription>, private readonly parser: MultiFormatParserService, @Inject('IAiProvider') private readonly aiProvider: IAiProvider) {}
  async upload(tenantId: string, patientRef: string, file: { buffer: Buffer; filename: string; mimeType?: string }) {
    if (!patientRef.startsWith('synthetic:') && !patientRef.startsWith('local-file:')) throw new BadRequestException('PRESCRIPTION_UPLOAD_REQUIRES_DEVELOPMENT_PATIENT');
    if (!file.buffer?.length) throw new BadRequestException('INVALID_FILE');
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/markdown'].includes(file.mimeType || '')) throw new BadRequestException('UNSUPPORTED_FILE');
    const isMultimodal = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType || '');
    const parsed = isMultimodal ? { content: '', checksum: require('crypto').createHash('sha256').update(file.buffer).digest('hex') } : await this.parser.parseDocument(file.buffer, file.filename, file.mimeType);
    const extracted = isMultimodal ? await this.extractWithGemini(file) : null;
    const documentId = randomUUID();
    const medications = extracted?.medicines || this.extractMedications(parsed.content);
    const investigations = extracted?.investigations || this.extractInvestigations(parsed.content);
    const prescription = await this.prescriptions.save(this.prescriptions.create({ tenantId, patientRef, prescriptionId: randomUUID(), sourceDocumentId: documentId, filename: file.filename, checksum: parsed.checksum, extractedText: parsed.content, medications, investigations, extractionStatus: 'REVIEW_REQUIRED' }));
    return prescription;
  }
  async list(tenantId: string, patientRef?: string) { return this.prescriptions.find({ where: patientRef ? { tenantId, patientRef } : { tenantId }, order: { createdAt: 'DESC' } }); }
  async approve(tenantId: string, id: string) { const record = await this.prescriptions.findOne({ where: { id, tenantId } }); if (!record) throw new NotFoundException('PRESCRIPTION_NOT_FOUND'); record.extractionStatus = 'APPROVED'; return this.prescriptions.save(record); }
  async approvedForPatient(tenantId: string, patientRef: string) { return this.prescriptions.find({ where: { tenantId, patientRef, extractionStatus: 'APPROVED' }, order: { createdAt: 'DESC' } }); }
  private extractMedications(text: string): Array<Record<string, string | null>> {
    return text.split(/\r?\n/).flatMap((line) => {
      const match = line.trim().match(/^([A-Za-z][A-Za-z .-]{1,80}?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))\b(.*)$/i); if (!match) return [];
      const rest = match[3]!.trim(); const find = (pattern: RegExp) => rest.match(pattern)?.[0] || null;
      return [{ medicationName: match[1]!.trim(), strength: match[2]!.trim(), dosage: find(/\b\d+\s*(?:tablet|tab|capsule|cap|ml)\b/i), frequency: find(/\b(?:once|twice|three times)\s+(?:a\s+)?daily\b|\b(?:OD|BD|TDS)\b/i), route: find(/\b(?:oral|topical|inhaled|injection)\b/i), timing: find(/\b(?:morning|afternoon|night|before meals|after meals|with meals)\b/i), duration: find(/\b(?:for\s+)?\d+\s+days?\b/i), instructions: rest || null }];
    });
  }
  private extractInvestigations(text: string): Array<Record<string, string | null>> { const known = /\b(HbA1c|CBC|Lipid Profile|Creatinine|Blood Sugar|Fasting Blood Sugar|PPBS)\b/ig; const found = new Map<string, string>(); for (const match of text.matchAll(known)) { const rawName = match[0].trim(); found.set(rawName.toLowerCase(), rawName); } return [...found.values()].map((rawName) => ({ rawName, normalizedName: rawName, reason: null, instructions: null, confidence: 'HIGH' })); }
  private async extractWithGemini(file: { buffer: Buffer; filename: string; mimeType?: string }) {
    const extractionPrompt = `You are extracting information from a patient's prescription image or PDF.\n\nDOCUMENT EXTRACTION ONLY. Read only facts actually visible in the document; do not provide medical explanation or advice. Do not guess handwriting. If a medicine name, dosage, frequency, timing, duration, diagnosis, test, doctor name, or date is unclear, return null and use LOW confidence. Return only the requested JSON structure.`;
    try {
      const providerHealth = await this.aiProvider.healthCheck();
      if (providerHealth.status !== 'AVAILABLE') {
        throw new ServiceUnavailableException('PRESCRIPTION_SERVICE_UNAVAILABLE');
      }
      const result = await this.aiProvider.generate(extractionPrompt, {
        responseFormat: 'json',
        temperature: 0,
        timeoutMs: 120000,
        telemetryLabel: 'MULTIMODAL_PRESCRIPTION',
        inlineData: [{ mimeType: file.mimeType || 'application/octet-stream', data: file.buffer }],
        jsonSchema: this.prescriptionExtractionSchema(),
      });
      const json: any = result.json;
      const schemaValid = Boolean(json && Array.isArray(json.medicines) && Array.isArray(json.investigations));
      if (process.env.NODE_ENV === 'development') {
        this.logger.log(`[MULTIMODAL_PRESCRIPTION] model=${result.model} mime=${file.mimeType || 'unknown'} json_valid=${Boolean(json)} schema_valid=${schemaValid}`);
      }
      if (!schemaValid) throw new Error('INVALID_PRESCRIPTION_EXTRACTION');
      return {
        medicines: json.medicines.map((m: any) => ({ medicationName: m.rawName || null, normalizedName: m.normalizedName || null, strength: m.strength || null, dosage: m.dosage || null, dosageForm: m.dosageForm || null, route: m.route || null, frequency: m.frequency || null, timing: m.timing || null, duration: m.duration || null, instructions: m.instructions || null, confidence: m.confidence || 'LOW' })),
        investigations: json.investigations.map((i: any) => ({ rawName: i.rawName || null, normalizedName: i.normalizedName || null, reason: i.reason || null, instructions: i.instructions || null, confidence: i.confidence || 'LOW' })),
      };
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      const category = error instanceof Error ? error.message.replace(/\s+/g, '_').slice(0, 160) : 'UNKNOWN';
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn(`[MULTIMODAL_PRESCRIPTION] mime=${file.mimeType || 'unknown'} validation=false provider_error=${category}`);
      }
      const providerFailure = error instanceof Error && /GEMINI_PROVIDER_UNAVAILABLE|Gemini API returned status (401|403|408|429|500|502|503|504)|abort|timeout/i.test(error.message);
      if (providerFailure) throw new ServiceUnavailableException('PRESCRIPTION_SERVICE_UNAVAILABLE');
      throw new BadRequestException('PRESCRIPTION_EXTRACTION_FAILED');
    }
  }
  private prescriptionExtractionSchema(): Record<string, unknown> {
    // Gemini's Schema proto uses nullable rather than JSON Schema's
    // `type: ['string', 'null']` union form.
    const nullableString = { type: 'STRING', nullable: true };
    const confidence = { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] };
    return {
      type: 'OBJECT',
      properties: {
        prescriptionDate: nullableString,
        doctorName: nullableString,
        facilityName: nullableString,
        diagnosis: nullableString,
        medicines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { rawName: nullableString, normalizedName: nullableString, strength: nullableString, dosage: nullableString, dosageForm: nullableString, route: nullableString, frequency: nullableString, timing: nullableString, duration: nullableString, instructions: nullableString, confidence } } },
        investigations: { type: 'ARRAY', items: { type: 'OBJECT', properties: { rawName: nullableString, normalizedName: nullableString, reason: nullableString, instructions: nullableString, confidence } } },
        instructions: { type: 'ARRAY', items: nullableString },
        followUp: nullableString,
      },
      required: ['medicines', 'investigations'],
    };
  }
}
