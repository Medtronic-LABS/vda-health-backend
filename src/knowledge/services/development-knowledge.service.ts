/* eslint-disable */
import { Injectable, Logger } from '@nestjs/common';
import { IKnowledgeRetrievalService } from '../interfaces/knowledge-retrieval.interface';
import {
  KnowledgeRetrievalOptions,
  KnowledgeRetrievalResult,
  KnowledgeMatchChunk,
  KnowledgeSourceCitation,
} from '../models/knowledge-retrieval.model';

@Injectable()
export class DevelopmentKnowledgeService implements IKnowledgeRetrievalService {
  private readonly logger = new Logger(DevelopmentKnowledgeService.name);

  private readonly syntheticFixtures: Array<{
    documentId: string;
    version: string;
    title: string;
    source: string;
    domain: string;
    category: string;
    language: string;
    keywords: string[];
    content: string;
  }> = [
    {
      documentId: 'dev-doc-diabetes',
      version: '1.0',
      title: 'Diabetes Overview & Health Guide',
      source: 'National Health Portal Guide',
      domain: 'disease',
      category: 'clinical_guidelines',
      language: 'hi',
      keywords: ['diabetes', 'डायबिटीज', 'मधुमेह', 'sugar', 'शुगर', 'glucose'],
      content:
        '[SYNTHETIC-DEV-KNOWLEDGE] डायबिटीज (मधुमेह) एक पुरानी स्थिति है जहां शरीर रक्त शर्करा (ग्लूकोज) को प्रभावी ढंग से संसाधित नहीं कर पाता है। मुख्य प्रकारों में टाइप 1 और टाइप 2 डायबिटीज शामिल हैं। नियमित व्यायाम, संतुलित आहार, और समय पर दवाएं इसे नियंत्रित रखने में मदद करती हैं।',
    },
    {
      documentId: 'dev-doc-hba1c',
      version: '1.0',
      title: 'HbA1c Laboratory Test Explanation',
      source: 'Clinical Diagnostic Guidelines 2026',
      domain: 'laboratory',
      category: 'diagnostic_education',
      language: 'hi',
      keywords: [
        'hba1c',
        'hb a1c',
        'एचबीए1सी',
        'lab',
        'report',
        'रिपोर्ट',
        'test',
      ],
      content:
        '[SYNTHETIC-DEV-KNOWLEDGE] HbA1c (ग्लाइकेटेड हीमोग्लोबिन) परीक्षण पिछले 2 से 3 महीनों के औसत रक्त शर्करा (ब्लड शुगर) स्तर को मापता है। सामान्य स्तर 5.7% से कम होता है; 5.7% से 6.4% प्री-डायबिटीज दर्शाता है, और 6.5% या उससे अधिक डायबिटीज का संकेत देता है।',
    },
    {
      documentId: 'dev-doc-hypertension',
      version: '1.0',
      title: 'Hypertension Management Guidelines',
      source: 'Indian Medical Practice Standards',
      domain: 'disease',
      category: 'clinical_guidelines',
      language: 'hi',
      keywords: [
        'hypertension',
        'blood pressure',
        'bp',
        'हाई बीपी',
        'उच्च रक्तचाप',
      ],
      content:
        '[SYNTHETIC-DEV-KNOWLEDGE] उच्च रक्तचाप (हाइपरटेंशन) तब होता है जब धमनियों में रक्त का दबाव लगातार अधिक रहता है। सामान्य बीपी 120/80 mmHg होता है। नमक का सेवन कम करना, तनाव प्रबंधन और नियमित जांच बीपी नियंत्रण में सहायक हैं।',
    },
    {
      documentId: 'dev-doc-metformin',
      version: '1.0',
      title: 'Metformin Medication Patient Information',
      source: 'National Formulary Education',
      domain: 'medication',
      category: 'medication_education',
      language: 'hi',
      keywords: [
        'metformin',
        'मेटफॉर्मिन',
        'medicine',
        'दवा',
        'tablet',
        'गोली',
      ],
      content:
        '[SYNTHETIC-DEV-KNOWLEDGE] मेटफॉर्मिन टाइप 2 डायबिटीज के इलाज में व्यापक रूप से इस्तेमाल की जाने वाली दवा है। यह यकृत द्वारा उत्पादित ग्लूकोज की मात्रा को कम करती है और इंसुलिन संवेदनशीलता में सुधार करती है। इसे आमतौर पर भोजन के साथ लिया जाता है।',
    },
    {
      documentId: 'dev-doc-pmjay',
      version: '1.0',
      title: 'Ayushman Bharat PM-JAY Scheme Guide',
      source: 'National Health Authority (NHA)',
      domain: 'government_schemes',
      category: 'ayushman_bharat',
      language: 'hi',
      keywords: [
        'pmjay',
        'pm-jay',
        'ayushman',
        'आयुष्मान',
        'scheme',
        'योजना',
        'card',
        'कार्ड',
        '5 lakh',
        '५ लाख',
      ],
      content:
        '[SYNTHETIC-DEV-KNOWLEDGE] आयुष्मान भारत प्रधानमंत्री जन आरोग्य योजना (PM-JAY) पात्र परिवारों को प्रति वर्ष प्रति परिवार ₹5 लाख तक का मुफ्त द्वितीयक और तृतीयक अस्पताल में इलाज की सुरक्षा प्रदान करती है। इसमें कैशलैश और पेपरलेस अस्पताल में भर्ती शामिल है।',
    },
    {
      documentId: 'dev-doc-facilities',
      version: '1.0',
      title: 'Primary Healthcare Facilities Directory (PHC/CHC)',
      source: 'Ministry of Health & Family Welfare',
      domain: 'healthcare_facilities',
      category: 'clinics',
      language: 'hi',
      keywords: [
        'phc',
        'chc',
        'hospital',
        'अस्पताल',
        'clinic',
        'क्लिनिक',
        'facility',
        'सुविधा',
        'doctor',
      ],
      content:
        '[SYNTHETIC-DEV-KNOWLEDGE] प्राथमिक स्वास्थ्य केंद्र (PHC) और सामुदायिक स्वास्थ्य केंद्र (CHC) ग्रामीण और शहरी क्षेत्रों में प्राथमिक और आपातकालीन चिकित्सा सेवाएं प्रदान करते हैं। इनमें मुफ्त टीकाकरण, मातृ एवं शिशु स्वास्थ्य देखभाल, और आवश्यक दवाएं उपलब्ध हैं।',
    },
    {
      documentId: 'dev-doc-referral',
      version: '1.0',
      title: 'Clinical Referral Pathways & Emergency Care Protocols',
      source: 'Indian Referral Health Standards',
      domain: 'referral_protocols',
      category: 'referral_protocols',
      language: 'hi',
      keywords: [
        'referral',
        'refer',
        'रिफर',
        'pathway',
        'tertiary',
        'district hospital',
        'जिला अस्पताल',
        'emergency',
      ],
      content:
        '[SYNTHETIC-DEV-KNOWLEDGE] यदि किसी मरीज को विशेष उपचार या सर्जरी की आवश्यकता होती है, तो PHC/CHC चिकित्सक द्वारा मरीज को जिला अस्पताल या मेडिकल कॉलेज (तृतीयक केंद्र) के लिए रेफरल पर्ची जारी की जाती है। आपातकालीन मामलों में एम्बुलेंस (108) सहायता उपलब्ध है।',
    },
  ];

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async retrieve(
    query = '',
    options?: KnowledgeRetrievalOptions,
  ): Promise<KnowledgeRetrievalResult> {
    const startTime = Date.now();
    const qLower = (query || options?.query || '').toLowerCase().trim();
    const targetDomain = options?.domain;
    const maxResults = options?.maxResults || 5;

    this.logger.log(
      `[DevelopmentKnowledgeService] Searching synthetic knowledge query="${qLower}" domain="${targetDomain || 'ALL'}"`,
    );

    let matches = this.syntheticFixtures.filter((fixture) => {
      if (targetDomain && fixture.domain !== targetDomain) {
        // Allow domain mapping override if explicitly targeted
        if (
          targetDomain !== 'general' &&
          targetDomain !== 'preventive_health'
        ) {
          return false;
        }
      }
      return true;
    });

    if (qLower) {
      matches = matches.filter((fixture) => {
        return fixture.keywords.some(
          (kw) => qLower.includes(kw) || kw.includes(qLower),
        );
      });
    }

    if (matches.length === 0 && qLower.length > 0) {
      // Fallback: return general diabetes/health knowledge if query provided but no direct keyword match
      matches = [this.syntheticFixtures[0]];
    }

    const matchedChunks: KnowledgeMatchChunk[] = matches
      .slice(0, maxResults)
      .map((m, idx) => ({
        chunkId: `dev-chunk-${m.documentId}-${idx}`,
        documentId: m.documentId,
        documentVersion: m.version,
        title: m.title,
        content: m.content,
        source: m.source,
        language: m.language,
        domain: m.domain,
        category: m.category,
        relevanceScore: Math.max(0.75, 0.95 - idx * 0.05),
      }));

    const sources: KnowledgeSourceCitation[] = Array.from(
      new Set(matchedChunks.map((c) => c.documentId)),
    ).map((docId) => {
      const chunk = matchedChunks.find((c) => c.documentId === docId)!;
      return {
        title: chunk.title,
        source: chunk.source,
        version: chunk.documentVersion,
        domain: chunk.domain,
      };
    });

    const formattedKnowledgePrompt = matchedChunks
      .map(
        (c) =>
          `[KNOWLEDGE SOURCE]\nTitle: ${c.title}\nSource: ${c.source} (v${c.documentVersion})\nDomain: ${c.domain}\nContent:\n${c.content}\n[/KNOWLEDGE SOURCE]`,
      )
      .join('\n\n');

    return {
      matchedChunks,
      sources,
      formattedKnowledgePrompt,
      retrievedCount: matchedChunks.length,
      intent: options?.intent || 'GENERAL_HEALTH_QUERY',
      providerType: 'development_fixtures',
      latencyMs: Date.now() - startTime,
    };
  }
}
