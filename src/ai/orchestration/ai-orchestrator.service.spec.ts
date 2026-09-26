import { Facility } from '../../database/entities/facility.entity';
import { FacilitySearchResult } from '../../facilities/facility-search.service';
import { prioritizeSourceBackedCandidates } from '../../facilities/facility-service-matcher';
import { AiOrchestratorService } from './ai-orchestrator.service';

describe('IPHS-based facility service recommendations', () => {
  const result = (
    id: string,
    supportedServices: string[] | null,
  ): FacilitySearchResult => ({
    facility: {
      id,
      facilityId: id,
      name: id,
      city: 'Faridabad',
      district: 'Faridabad',
      state: 'Haryana',
      hospitalType: 'Government',
      contactNumber: null,
      supportedServices,
      specialityCodes: [],
    } as unknown as Facility,
    schemes: [],
    iphsOverlay: {
      iphsLevel: 'CHC',
      iphsClassification: 'CHC_NOT_SUBCLASSIFIED',
      iphsServices: { status: 'NOT_VERIFIED', services: [] },
      iphsVerified: false,
      emergencyCapability: 'UNKNOWN',
      referralLevel: 'SECONDARY',
    } as any,
    demoCapabilities: [],
    distanceKm: null,
    travelTimeMinutes: null,
  });

  const format = (results: FacilitySearchResult[], matchedSourceValues: string[]) => {
    const service = Object.create(
      AiOrchestratorService.prototype,
    ) as AiOrchestratorService;
    return (service as any).facilityContent(
      results,
      { state: 'Haryana', district: 'Faridabad' },
      'hi',
      undefined,
      false,
      {
        requestedService: 'HbA1c',
        appropriateIphsLevels: ['CHC'],
        lowCostPreference: false,
        matchedSourceValues,
        iphsSources: [],
        iphsEvidenceStatus: 'VERIFIED',
      },
    );
  };

  it('keeps IPHS-only candidates and clearly says individual availability is unverified', () => {
    const content = format([result('CHC Kheri Kalan', null)], []);

    expect(content.facility_results.map((facility: any) => facility.name)).toEqual([
      'CHC Kheri Kalan',
    ]);
    expect(content.summary).toContain('IPHS मानकों');
    expect(content.summary).toContain('अभी उपलब्धता की पुष्टि नहीं');
    expect(content.summary).not.toContain('HbA1c उपलब्ध है');
    expect(content.facility_results[0].iphsServices.status).toBe('NOT_VERIFIED');
    expect(content.cards[0].subtitle).toContain('उपयुक्त केंद्र स्तर');
  });

  it('ranks source-listed services first while retaining the other IPHS-level facilities', () => {
    const candidates = [
      result('IPHS-only CHC', null),
      result('Source-listed CHC', ['HbA1c']),
    ];
    const ranked = prioritizeSourceBackedCandidates(candidates, ['HbA1c']);
    const content = format(ranked, ['HbA1c']);

    expect(content.facility_results.map((facility: any) => facility.name)).toEqual([
      'Source-listed CHC',
      'IPHS-only CHC',
    ]);
    expect(content.summary).toContain('source records');
    expect(content.summary).toContain('IPHS मानकों');
    expect(content.summary).toContain('अभी की उपलब्धता की पुष्टि नहीं');
    expect(content.serviceAvailability).toBe('NOT_VERIFIED');
  });

});

describe('IPHS service-specific retrieval', () => {
  const chunk = (
    title: string,
    content: string,
    chunkId: string,
  ) => ({
    chunkId,
    documentId: chunkId,
    documentVersion: '2022',
    title,
    content,
    source: title,
    language: 'en',
    domain: 'healthcare_facilities',
    category: 'iphs_2022_facility_standards',
    relevanceScore: 0.4,
  });

  it('passes only service-specific IPHS passages to the level resolver', async () => {
    const service = Object.create(AiOrchestratorService.prototype) as any;
    const generic = chunk(
      'IPHS 2022 - SDH DH Guidelines',
      'General infrastructure and service provision standards.',
      'generic',
    );
    const ecg = chunk(
      'IPHS 2022 - SDH DH Guidelines',
      'Electrocardiography (ECG) E E E E E E E',
      'ecg',
    );
    const unrelated = chunk('NCD Guidelines 2023', 'ECG equipment', 'ncd');
    service.knowledgeRetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        matchedChunks: [generic, ecg, unrelated],
        sources: [
          { title: generic.title, source: generic.source, version: '2022' },
          { title: unrelated.title, source: unrelated.source, version: '2022' },
        ],
        formattedKnowledgePrompt: '',
        retrievedCount: 3,
        intent: 'FACILITY_SERVICE_LEVEL',
        providerType: 'postgres_pgvector',
        latencyMs: 1,
      }),
    };
    service.aiProvider = {
      generate: jest.fn().mockResolvedValue({
        json: { evidenceStatus: 'VERIFIED', levels: ['CHC', 'SDH', 'DH'] },
      }),
    };

    const resolved = await service.resolveIphsLevelsForService(
      'pilot-tenant', 'ECG', 'hi', 'HARYANA', 'focused-check',
    );

    expect(service.knowledgeRetrievalService.retrieve).toHaveBeenCalledWith(
      'Electrocardiography ECG',
      expect.objectContaining({
        tenantId: 'pilot-tenant',
        domain: 'healthcare_facilities',
        category: 'iphs_2022_facility_standards',
      }),
    );
    const [prompt, options] = service.aiProvider.generate.mock.calls[0];
    expect(prompt).toContain(ecg.content);
    expect(prompt).not.toContain(generic.content);
    expect(prompt).not.toContain(unrelated.content);
    expect(options.thinkingLevel).toBe('MINIMAL');
    expect(resolved).toEqual({
      levels: ['CHC', 'SDH', 'DH'],
      sources: [{ title: ecg.title, source: ecg.source, version: '2022' }],
      evidenceStatus: 'VERIFIED',
    });
  });

  it('does not infer ECG levels from unrelated or generic chunks', async () => {
    const service = Object.create(AiOrchestratorService.prototype) as any;
    service.knowledgeRetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        matchedChunks: [
          chunk('IPHS 2022 - SDH DH Guidelines', 'General standards.', 'generic'),
          chunk('NCD Guidelines 2023', 'ECG equipment', 'ncd'),
        ],
        sources: [],
        formattedKnowledgePrompt: '',
        retrievedCount: 2,
        intent: 'FACILITY_SERVICE_LEVEL',
        providerType: 'postgres_pgvector',
        latencyMs: 1,
      }),
    };
    service.aiProvider = { generate: jest.fn() };

    const resolved = await service.resolveIphsLevelsForService(
      'pilot-tenant', 'ECG', 'hi', 'HARYANA', 'focused-check',
    );

    expect(resolved).toEqual({
      levels: [],
      sources: [],
      evidenceStatus: 'NOT_VERIFIED',
    });
    expect(service.aiProvider.generate).not.toHaveBeenCalled();
  });

  it('passes low-similarity exact MRI evidence to the resolver without assigning a level itself', async () => {
    const service = Object.create(AiOrchestratorService.prototype) as any;
    const generic = chunk('IPHS 2022 - SDH DH Guidelines', 'General standards.', 'generic');
    const mri = { ...chunk('IPHS 2022 - SDH DH Guidelines',
      'Magnetic Resonance Imaging (MRI) - D D D', 'mri'), relevanceScore: 0.22 };
    service.knowledgeRetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        matchedChunks: [generic],
        sources: [{ title: generic.title, source: generic.source, version: '2022' }],
        formattedKnowledgePrompt: '', retrievedCount: 1,
        intent: 'FACILITY_SERVICE_LEVEL', providerType: 'postgres_pgvector', latencyMs: 1,
      }),
      retrieveIphsServiceChunks: jest.fn().mockResolvedValue([mri]),
    };
    service.aiProvider = { generate: jest.fn().mockResolvedValue({
      json: { evidenceStatus: 'VERIFIED', levels: ['SDH'] },
    }) };

    const resolved = await service.resolveIphsLevelsForService(
      'pilot-tenant', 'MRI', 'hi', 'Haryana', 'focused-check',
    );
    expect(service.knowledgeRetrievalService.retrieveIphsServiceChunks)
      .toHaveBeenCalledWith(['MRI'], 'pilot-tenant', 'Haryana', 3);
    const [prompt] = service.aiProvider.generate.mock.calls[0];
    expect(prompt).toContain(mri.content);
    expect(prompt).not.toContain(generic.content);
    expect(resolved.levels).toEqual(['SDH']);
    expect(resolved.evidenceStatus).toBe('VERIFIED');
  });

  it('rejects unsupported service despite generic semantic chunks', async () => {
    const service = Object.create(AiOrchestratorService.prototype) as any;
    service.knowledgeRetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        matchedChunks: [chunk('IPHS 2022 - SDH DH Guidelines', 'General standards.', 'generic')],
        sources: [], formattedKnowledgePrompt: '', retrievedCount: 1,
        intent: 'FACILITY_SERVICE_LEVEL', providerType: 'postgres_pgvector', latencyMs: 1,
      }),
      retrieveIphsServiceChunks: jest.fn().mockResolvedValue([]),
    };
    service.aiProvider = { generate: jest.fn() };
    const resolved = await service.resolveIphsLevelsForService(
      'pilot-tenant', 'quantum nanorobot imaging', 'hi', 'Haryana', 'focused-check',
    );
    expect(resolved).toEqual({ levels: [], sources: [], evidenceStatus: 'NOT_VERIFIED' });
    expect(service.aiProvider.generate).not.toHaveBeenCalled();
  });

  it('does not use the former X-ray demo mapping when governed evidence is absent', async () => {
    const service = Object.create(AiOrchestratorService.prototype) as any;
    service.knowledgeRetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        matchedChunks: [], sources: [], formattedKnowledgePrompt: '', retrievedCount: 0,
        intent: 'FACILITY_SERVICE_LEVEL', providerType: 'postgres_pgvector', latencyMs: 1,
      }),
      retrieveIphsServiceChunks: jest.fn().mockResolvedValue([]),
    };
    service.aiProvider = { generate: jest.fn() };
    const resolved = await service.resolveIphsLevelsForService(
      'pilot-tenant', 'X-ray', 'hi', 'Haryana', 'focused-check',
    );
    expect(resolved).toEqual({ levels: [], sources: [], evidenceStatus: 'NOT_VERIFIED' });
    expect(service.aiProvider.generate).not.toHaveBeenCalled();
    const content = service.facilityContent([], { district: 'Faridabad' }, 'hi',
      undefined, false, {
        requestedService: 'X-ray', appropriateIphsLevels: resolved.levels,
        lowCostPreference: false, matchedSourceValues: [], iphsSources: [],
        iphsEvidenceStatus: resolved.evidenceStatus,
      });
    expect(content.cards).toEqual([]);
    expect(content.facility_results).toEqual([]);
    expect(content.summary).toContain('कोई facility recommendation नहीं');
  });

  it('treats retrieval infrastructure failure as retryable, not absent IPHS support', async () => {
    const service = Object.create(AiOrchestratorService.prototype) as any;
    service.knowledgeRetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        matchedChunks: [], sources: [], formattedKnowledgePrompt: '', retrievedCount: 0,
        intent: 'FACILITY_SERVICE_LEVEL', providerType: 'postgres_pgvector_error', latencyMs: 1,
      }),
      retrieveIphsServiceChunks: jest.fn(),
    };
    service.aiProvider = { generate: jest.fn() };
    const resolved = await service.resolveIphsLevelsForService(
      'pilot-tenant', 'HbA1c', 'hi', 'Haryana', 'focused-check',
    );
    expect(resolved).toEqual({ levels: [], sources: [], evidenceStatus: 'UNAVAILABLE' });
    expect(service.knowledgeRetrievalService.retrieveIphsServiceChunks).not.toHaveBeenCalled();
    const content = service.facilityContent([], { district: 'Faridabad' }, 'hi',
      undefined, false, {
        requestedService: 'HbA1c', appropriateIphsLevels: resolved.levels,
        lowCostPreference: false, matchedSourceValues: [], iphsSources: [],
        iphsEvidenceStatus: resolved.evidenceStatus,
      });
    expect(content.cards).toEqual([]);
    expect(content.summary).toContain('दोबारा कोशिश करें');
    expect(content.summary).not.toContain('establish नहीं हो सका');
  });

  it('does not recommend facilities when the level resolver fails', async () => {
    const service = Object.create(AiOrchestratorService.prototype) as any;
    const xray = chunk('IPHS 2022 - CHC Guidelines',
      'Imaging services such as x-Ray are listed for CHC.', 'xray');
    service.logger = { warn: jest.fn() };
    service.knowledgeRetrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        matchedChunks: [xray],
        sources: [{ title: xray.title, source: xray.source, version: '2022' }],
        formattedKnowledgePrompt: '', retrievedCount: 1,
        intent: 'FACILITY_SERVICE_LEVEL', providerType: 'postgres_pgvector', latencyMs: 1,
      }),
      retrieveIphsServiceChunks: jest.fn().mockResolvedValue([]),
    };
    service.aiProvider = { generate: jest.fn().mockRejectedValue(new Error('provider unavailable')) };
    const resolved = await service.resolveIphsLevelsForService(
      'pilot-tenant', 'X-ray', 'hi', 'Haryana', 'focused-check',
    );
    expect(resolved).toEqual({ levels: [], sources: [], evidenceStatus: 'UNAVAILABLE' });
  });
});
