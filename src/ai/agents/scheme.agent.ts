/* eslint-disable */
import { Injectable, Logger } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../../agents/interfaces/agent.interface';

@Injectable()
export class SchemeAgent implements IAgent {
  readonly agentId = 'scheme-agent';
  private readonly logger = new Logger(SchemeAgent.name);

  async process(input: AgentProcessRequest): Promise<AgentProcessResult> {
    const lang = input.intentMetadata?.language || 'hi';
    const lower = input.inputText.toLowerCase();
    this.logger.log(
      `[SchemeAgent] Processing query="${input.inputText}" lang="${lang}"`,
    );

    const isHimcare = /himcare|हिमकेयर/i.test(lower);

    if (isHimcare) {
      const hiText = '**HIMCARE (हिमकेयर - मुख्यमंत्री हिमाचल हेल्थ केयर योजना)** हिमाचल प्रदेश सरकार की स्वास्थ्य सुरक्षा योजना है:\n\n• **कवरेज:** ₹5 लाख प्रति वर्ष तक कैशलेस इलाज\n• **लाभार्थी:** आयुष्मान भारत (PM-JAY) में शामिल न होने वाले हिमाचल प्रदेश के निवासी\n• **आवश्यक दस्तावेज:** राशन कार्ड, BPL प्रमाण पत्र, या श्रेणी प्रमाण पत्र\n\nयदि आप चाहें तो मैं इसके नजदीकी एम्पैनल्ड अस्पतालों की जानकारी दे सकता हूँ।';
      const enText = '**HIMCARE (Mukhya Mantri Himachal Health Care Scheme)** is a Himachal Pradesh state healthcare scheme:\n\n• **Coverage:** Up to ₹5 Lakh per family per year for cashless treatment\n• **Beneficiaries:** Resident families of Himachal Pradesh not covered under PM-JAY\n• **Verification:** Requires Ration Card, BPL certificate, or category proof\n\nIf you\'d like, I can provide the list of empaneled hospitals near you.';

      return {
        agentId: this.agentId,
        responseType: 'text',
        content: {
          summary: lang === 'hi' ? hiText : enText,
          hi: hiText,
          en: enText,
          cards: [
            {
              title: 'HIMCARE (हिमकेयर)',
              value: '₹5 लाख प्रति वर्ष कैशलेस इलाज',
              subtitle: 'हिमाचल प्रदेश सरकार • आधिकारिक पात्रता सत्यापन आवश्यक',
            },
          ],
        },
      };
    }

    const genericHi = 'आपके हिमाचल प्रदेश में मुख्य रूप से ये योजनाएँ उपलब्ध हैं:\n\n• **HIMCARE** (मुख्यमंत्री हिमाचल हेल्थ केयर योजना — ₹5 लाख/वर्ष)\n• **Ayushman Bharat PM-JAY** (आयुष्मान भारत योजना — ₹5 लाख/वर्ष)\n\nइन योजनाओं की पात्रता अलग-अलग हो सकती है। अगर आप चाहें तो मैं HIMCARE के बारे में विस्तार से बता सकता हूँ।';
    const genericEn = 'In Himachal Pradesh, key healthcare schemes available are:\n\n• **HIMCARE** (Mukhya Mantri Himachal Health Care Scheme — ₹5 Lakh/year)\n• **Ayushman Bharat PM-JAY** (National Health Scheme — ₹5 Lakh/year)\n\nEligibility for each scheme must be verified separately. If you wish, I can explain HIMCARE details.';

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: {
        summary: lang === 'hi' ? genericHi : genericEn,
        hi: genericHi,
        en: genericEn,
      },
    };
  }
}
