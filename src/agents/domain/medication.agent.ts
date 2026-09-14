import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../interfaces/agent.interface';

/**
 * Medication Agent
 *
 * Requirements:
 * - Do NOT use preexisting patient health data (EHR/ABDM medications).
 * - Rely strictly on the uploaded prescription.
 * - Explain medicines in simple language with prescribed timings.
 * - If no prescription is uploaded, guide patient to upload their prescription.
 */
@Injectable()
export class MedicationAgent implements IAgent {
  readonly agentId = 'medication-agent';

  async process(request: AgentProcessRequest): Promise<AgentProcessResult> {
    await Promise.resolve();
    const ctx = request.clinicalContext;
    const isHindi = request.intentMetadata.language === 'hi';

    const prescriptions = ctx?.prescriptions || [];

    // Strictly check for uploaded prescription; never fallback to preexisting EHR medications
    if (prescriptions.length === 0) {
      return {
        agentId: this.agentId,
        responseType: 'medication',
        content: {
          hi: 'दवाइयों की जानकारी के लिए कृपया अपनी डॉक्टर की पर्ची (Prescription) अपलोड करें। VDA केवल आपकी पर्ची के आधार पर दवाइयों को सरल भाषा में समझाएगा और सही समय अनुसार रिमाइंडर सेट करेगा।',
          en: 'To guide you safely on medicines, VDA relies strictly on your uploaded prescription. Please upload your doctor prescription document so I can explain your medicines in simple terms and set reminders based on the prescribed timings.',
          medications: [],
        },
      };
    }

    const medList = prescriptions.map((p) => ({
      name: p.medicationName,
      dosage: p.instructions || '',
      frequency: p.instructions || 'As prescribed',
      status: p.status,
    }));

    const medNamesEn = medList.map((m) => m.name).join(', ');

    return {
      agentId: this.agentId,
      responseType: 'medication',
      content: {
        hi: isHindi
          ? `आपकी अपलोड की गई पर्ची के अनुसार दवाएं: ${medNamesEn}। कृपया पर्ची में दिए गए समय अनुसार दवा लें।`
          : `Based on your uploaded prescription: ${medNamesEn}. Please take your medicines as scheduled on your prescription.`,
        en: `Based on your uploaded prescription: ${medNamesEn}. Please take your medicines as scheduled on your prescription.`,
        medications: medList,
      },
    };
  }
}
