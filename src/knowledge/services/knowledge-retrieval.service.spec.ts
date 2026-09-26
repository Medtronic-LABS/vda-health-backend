import {
  iphsServiceTermPattern,
  KnowledgeRetrievalService,
} from './knowledge-retrieval.service';

describe('bounded IPHS service lexical retrieval', () => {
  it('matches whole service terms and excludes generic words', () => {
    const mri = new RegExp(iphsServiceTermPattern('MRI')!, 'i');
    expect(mri.test('Magnetic Resonance Imaging (MRI)')).toBe(true);
    expect(mri.test('preMRIvalue')).toBe(false);
    expect(new RegExp(iphsServiceTermPattern('X-ray')!, 'i').test('x-Ray machine')).toBe(true);
    for (const term of ['test', 'scan', 'blood', 'service']) {
      expect(iphsServiceTermPattern(term)).toBeNull();
    }
  });

  it('retains exact IPHS evidence below the vector threshold within active tenant scope', async () => {
    const service = Object.create(KnowledgeRetrievalService.prototype) as any;
    service.configService = { knowledgeRagEnabled: true };
    service.localEmbeddingProvider = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    };
    service.dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{
        chunkId: 'mri-chunk',
        documentId: 'iphs-doc',
        documentVersion: '2022',
        title: 'IPHS 2022 - SDH DH Guidelines',
        content: 'Magnetic Resonance Imaging (MRI) - D D D',
        source: 'Indian Public Health Standards 2022',
        language: 'en',
        domain: 'healthcare_facilities',
        category: 'iphs_2022_facility_standards',
        metadata: { chunkIndex: 211 },
        cosineDistance: 0.78,
      }]),
    };

    const chunks = await service.retrieveIphsServiceChunks(
      ['MRI'], 'tenant-one', 'Haryana', 3,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].relevanceScore).toBe(0.22);
    const [sql, parameters] = service.dataSource.query.mock.calls[0];
    expect(sql).toContain("d.status = 'ACTIVE'");
    expect(sql).toContain('d."tenantId" = $1 AND c."tenantId" = $1');
    expect(sql).toContain("d.category = 'iphs_2022_facility_standards'");
    expect(sql).toContain("c.category = 'iphs_2022_facility_standards'");
    expect(sql).toContain("d.title ILIKE 'IPHS 2022%'");
    expect(sql).toContain("d.source ILIKE '%Indian Public Health Standards%'");
    expect(sql).toContain('c.content ~* ANY($2::text[])');
    expect(parameters[0]).toBe('tenant-one');
    expect(parameters[1]).toEqual([iphsServiceTermPattern('MRI')]);
    expect(parameters).toContain('Haryana');
  });

  it('cannot run a lexical lookup without a tenant or a specific service term', async () => {
    const service = Object.create(KnowledgeRetrievalService.prototype) as any;
    service.configService = { knowledgeRagEnabled: true };
    service.dataSource = { isInitialized: true, query: jest.fn() };
    service.localEmbeddingProvider = { generateEmbedding: jest.fn() };
    expect(await service.retrieveIphsServiceChunks(['MRI'], '')).toEqual([]);
    expect(await service.retrieveIphsServiceChunks(['test', 'blood'], 'tenant-one')).toEqual([]);
    expect(service.dataSource.query).not.toHaveBeenCalled();
    expect(service.localEmbeddingProvider.generateEmbedding).not.toHaveBeenCalled();
  });
});
