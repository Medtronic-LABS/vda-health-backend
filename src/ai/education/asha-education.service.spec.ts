import { AshaEducationService } from './asha-education.service';

const identity = { tenantId: 'tenant-a', externalId: 'user-a', preferredLanguage: 'en' } as any;

describe('ASHA NCD evidence gate', () => {
  const build = (rows: unknown[] = []) => {
    const db = { isInitialized: true, query: jest.fn().mockResolvedValue(rows) };
    const retrieval = { retrieve: jest.fn().mockResolvedValue({ matchedChunks: [] }) };
    const verification = { evaluateTurn: jest.fn() };
    const audit = { logEvent: jest.fn() };
    const ai = { healthCheck: jest.fn(), generate: jest.fn() };
    return { service: new AshaEducationService(db as any, retrieval as any, verification as any, audit as any, ai as any),
      db, retrieval, verification, audit, ai };
  };

  it('does not invent an ASHA answer when no published embedded module exists', async () => {
    const { service, retrieval, ai } = build();
    const answer = await service.maybeAnswer('Explain ASHA NCD training', identity, 'corr');
    expect(answer?.content.summary).toContain('could not find enough approved ASHA');
    expect(retrieval.retrieve).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('leaves clinical decisions and unrelated workflows to existing routing', async () => {
    const { service, db } = build();
    expect(await service.maybeAnswer('Should I change my diabetes medicine dose?', identity, 'corr')).toBeNull();
    expect(await service.maybeAnswer('What is ASHA advice for my diabetes medicine dose?', identity, 'corr')).toBeNull();
    expect(await service.maybeAnswer('Find a nearby hospital', identity, 'corr')).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects retrieval without evidence even when the module is indexed', async () => {
    const { service, retrieval } = build([{ id: 'doc-a', title: 'ASHA NCD module', version: '1', source: 'official', chunks: '2', embeddings: '2' }]);
    const answer = await service.maybeAnswer('What is diabetes?', identity, 'corr');
    expect(retrieval.retrieve).toHaveBeenCalledWith('What is diabetes?', expect.objectContaining({
      tenantId: 'tenant-a', documentId: 'doc-a', minRelevanceScore: 0.55,
    }));
    expect(answer?.content.summary).toContain('could not find enough approved ASHA');
  });

  it('fails closed if retrieval is unavailable', async () => {
    const { service, retrieval } = build([{ id: 'doc-a', title: 'ASHA NCD module', version: '1', source: 'official', chunks: '2', embeddings: '2' }]);
    retrieval.retrieve.mockRejectedValue(new Error('index unavailable'));
    const answer = await service.maybeAnswer('Explain ASHA NCD training', identity, 'corr');
    expect(answer?.content.summary).toContain('could not find enough approved ASHA');
  });

  it('accepts only a verified answer with citations to retrieved module chunks', async () => {
    const { service, retrieval, verification, audit, ai } = build([
      { id: 'doc-a', title: 'ASHA NCD module', version: '1', source: 'official', chunks: '1', embeddings: '1' },
    ]);
    retrieval.retrieve.mockResolvedValue({ matchedChunks: [{ chunkId: 'chunk-a', documentId: 'doc-a',
      documentVersion: '1', content: 'Diabetes is a long-term condition affecting blood sugar.',
      metadata: { page: 2, section: 'NCD basics' } }] });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { answer: 'Diabetes affects blood sugar.', usedChunkIds: ['chunk-a'] } });
    verification.evaluateTurn.mockResolvedValue({ passed: true, clinicalViolationDetected: false, unsupportedClaims: [] });
    audit.logEvent.mockResolvedValue(undefined);

    const answer = await service.maybeAnswer('What is diabetes?', identity, 'corr');
    expect(answer?.content.summary).toContain('Diabetes affects blood sugar.');
    const [prompt] = ai.generate.mock.calls[0];
    expect(prompt).toContain('calm, respectful warmth of an ASHA Didi');
    expect(prompt).toContain('not a human ASHA, ANM, nurse, or doctor');
    expect(prompt).toContain('Do not promise free care, scheme eligibility');
    expect(prompt).toContain('strictly use no more than 25 spoken words');
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      details: { citations: [{ documentId: 'doc-a', chunkId: 'chunk-a', version: '1', page: 2, section: 'NCD basics' }] },
    }));
  });

  it('does not reject safe education solely for mentioning treatment adherence', async () => {
    const { service, retrieval, verification, ai } = build([
      { id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' },
    ]);
    retrieval.retrieve.mockResolvedValue({ matchedChunks: [{ chunkId: 'chunk-a', documentId: 'doc-a',
      documentVersion: '1', content: 'ASHA workers support treatment adherence.', metadata: {} }] });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { answer: 'ASHA workers support treatment adherence.', usedChunkIds: ['chunk-a'] } });
    verification.evaluateTurn.mockResolvedValue({ passed: true, clinicalViolationDetected: false, unsupportedClaims: [] });
    const answer = await service.maybeAnswer('What does an ASHA worker do for NCD patients?', identity, 'corr', 'en');
    expect(answer?.content.summary).toContain('treatment adherence');
  });

  it('prefers the indexed BP lifestyle section over a generic follow-up chunk and omits routine disclaimers', async () => {
    const { service, retrieval, verification, ai } = build([
      { id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '2', embeddings: '2' },
    ]);
    const followUp = { chunkId: 'follow-up', documentId: 'doc-a', documentVersion: '1',
      content: 'Ensure monthly blood pressure monitoring.', metadata: {} };
    const lifestyle = { chunkId: 'lifestyle', documentId: 'doc-a', documentVersion: '1',
      content: 'Reduce salt, eat fruits and vegetables, stay physically active and avoid tobacco.', metadata: {} };
    retrieval.retrieve.mockResolvedValueOnce({ matchedChunks: [followUp] })
      .mockResolvedValueOnce({ matchedChunks: [lifestyle] });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValueOnce({ json: { query: 'precautions to control blood pressure' } })
      .mockResolvedValueOnce({ json: { answer: 'नमक कम करें, अच्छा भोजन खाएँ, चलें-फिरें और तंबाकू से बचें।',
        usedChunkIds: ['lifestyle'] } });
    verification.evaluateTurn.mockResolvedValue({ passed: true, clinicalViolationDetected: false, unsupportedClaims: [] });
    const answer = await service.maybeAnswer('BP ko control rakhne ke liye kya savdhani rakhein?', identity, 'corr', 'hi');
    expect(retrieval.retrieve).toHaveBeenNthCalledWith(2,
      'ASHA high blood pressure screening management reduce salt physical activity healthy diet avoid tobacco',
      expect.objectContaining({ minRelevanceScore: 0.55, documentId: 'doc-a' }));
    expect(answer?.content.summary).toBe('नमक कम करें, अच्छा भोजन खाएँ, चलें-फिरें और तंबाकू से बचें।');
    expect(verification.evaluateTurn).toHaveBeenCalledWith(expect.any(String), expect.any(String),
      [lifestyle.content], 'corr');
  });

  it('retrieves the symptom-free BP screening passage when the direct Hinglish query misses', async () => {
    const { service, retrieval, verification, ai } = build([
      { id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' },
    ]);
    const screening = { chunkId: 'screening', documentId: 'doc-a', documentVersion: '1',
      content: 'High BP may have no symptoms. Screening helps detect it early.', metadata: {} };
    retrieval.retrieve.mockResolvedValueOnce({ matchedChunks: [] })
      .mockResolvedValueOnce({ matchedChunks: [screening] });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValueOnce({ json: { query: 'Why high BP screening is done' } })
      .mockResolvedValueOnce({ json: { answer: 'बीपी बढ़ने पर भी लक्षण नहीं दिख सकते। जाँच से इसे जल्दी पता कर सकते हैं।',
        usedChunkIds: ['screening'] } });
    verification.evaluateTurn.mockResolvedValue({ passed: true, clinicalViolationDetected: false, unsupportedClaims: [] });
    const answer = await service.maybeAnswer('High BP ka screening kyun hota hai?', identity, 'corr', 'hi');
    expect(retrieval.retrieve).toHaveBeenCalledTimes(2);
    expect(answer?.content.summary).toContain('लक्षण नहीं दिख सकते');
  });

  it('retries a Latin-transliterated Hindi answer once with the same evidence', async () => {
    const { service, retrieval, verification, ai } = build([
      { id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' },
    ]);
    retrieval.retrieve.mockResolvedValue({ matchedChunks: [{ chunkId: 'activity', documentId: 'doc-a',
      documentVersion: '1', content: 'Physical activity helps maintain healthy body weight.', metadata: {} }] });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValueOnce({ json: { query: 'physical activity benefits' } })
      .mockResolvedValueOnce({ json: { answer: 'Roz chalne se vajan sahi rahta hai.', usedChunkIds: ['activity'] } })
      .mockResolvedValueOnce({ json: { answer: 'रोज चलने से वजन ठीक रखने में मदद मिलती है।', usedChunkIds: ['activity'] } });
    verification.evaluateTurn.mockResolvedValue({ passed: true, clinicalViolationDetected: false, unsupportedClaims: [] });
    const answer = await service.maybeAnswer('Roz exercise karna kyun zaroori hai?', identity, 'corr', 'hi');
    expect(answer?.content.summary).toBe('रोज चलने से वजन ठीक रखने में मदद मिलती है।');
    expect(ai.generate).toHaveBeenCalledTimes(3);
    expect(verification.evaluateTurn).toHaveBeenCalledWith(expect.any(String),
      'रोज चलने से वजन ठीक रखने में मदद मिलती है।', expect.any(Array), 'corr');
  });

  it.each([
    ['आशा एनसीडी में मधुमेह क्या है?', 'What is diabetes in ASHA NCD training?'],
    ['ASHA NCD mein diabetes kya hai?', 'What is diabetes in ASHA NCD training?'],
    ['ASHA NCD mein HbA1c 6.2 kya hai?', 'What is HbA1c 6.2 in ASHA NCD training?'],
    ['ASHA NCD mein Metformin kya hai?', 'What is Metformin in ASHA NCD training?'],
    ['ASHA NCD mein diabetes nahi kya hota hai?', 'What is not diabetes in ASHA NCD training?'],
  ])('uses an English evidence query for %s while preserving the original question', async (question, english) => {
    const { service, retrieval, ai } = build([{ id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' }]);
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { query: english } });
    await service.maybeAnswer(question, { ...identity, preferredLanguage: 'hi' }, 'corr');
    expect(retrieval.retrieve).toHaveBeenCalledWith(english, expect.objectContaining({ tenantId: 'tenant-a', documentId: 'doc-a', minRelevanceScore: 0.55 }));
    expect(ai.generate).toHaveBeenCalledTimes(1);
  });

  it('fails closed when translation drops a number or negation', async () => {
    const { service, retrieval, ai } = build([{ id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' }]);
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { query: 'What is diabetes?' } });
    const answer = await service.maybeAnswer('ASHA NCD mein diabetes 6.2 nahi hai?', identity, 'corr');
    expect(answer?.content.summary).toContain('स्वीकृत आशा');
    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });

  it('answers in the original language using the original question and approved evidence', async () => {
    const { service, retrieval, verification, ai } = build([{ id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' }]);
    const question = 'आशा एनसीडी में मधुमेह क्या है?';
    retrieval.retrieve.mockResolvedValue({ matchedChunks: [{ chunkId: 'chunk-a', documentId: 'doc-a',
      documentVersion: '1', content: 'Diabetes affects blood sugar.', metadata: {} }] });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValueOnce({ json: { query: 'What is diabetes in ASHA NCD training?' } })
      .mockResolvedValueOnce({ json: { answer: 'मधुमेह रक्त शर्करा को प्रभावित करता है।', usedChunkIds: ['chunk-a'] } });
    verification.evaluateTurn.mockResolvedValue({ passed: true, clinicalViolationDetected: false, unsupportedClaims: [] });
    const answer = await service.maybeAnswer(question, { ...identity, preferredLanguage: 'hi' }, 'corr');
    expect(answer?.content.summary).toContain('मधुमेह');
    expect(ai.generate.mock.calls[1][0]).toContain(`Question: ${question}`);
    expect(verification.evaluateTurn).toHaveBeenCalledWith(question, 'मधुमेह रक्त शर्करा को प्रभावित करता है।',
      ['Diabetes affects blood sugar.'], 'corr');
  });

  it('fails closed when an identified medicine name is removed from the retrieval query', async () => {
    const { service, retrieval, ai } = build([{ id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' }]);
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { query: 'What is diabetes in ASHA training?' } });
    await service.maybeAnswer('ASHA NCD mein Metformin kya hai?', identity, 'corr');
    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });

  it('allows a generic sugar diet term to translate to diabetes nutrition without dropping a medicine name', async () => {
    const { service, retrieval, ai } = build([{ id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' }]);
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { query: 'diabetes diet nutrition advice' } });
    await service.maybeAnswer('Sugar ke patient ko khane-peene mein kya dhyan rakhna chahiye?', identity, 'corr');
    expect(retrieval.retrieve).toHaveBeenCalledWith('diabetes diet nutrition advice', expect.objectContaining({ minRelevanceScore: 0.55 }));
  });

  it('retries an equivalent prevention query at the unchanged evidence threshold', async () => {
    const { service, retrieval, ai } = build([{ id: 'doc-a', title: 'ASHA NCD', version: '1', source: 'official', chunks: '1', embeddings: '1' }]);
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { query: 'preventing diabetes in the community' } });
    await service.maybeAnswer('Diabetes se bachav ke liye kya karna chahiye?', identity, 'corr');
    expect(retrieval.retrieve).toHaveBeenNthCalledWith(2, 'diabetes prevention risk reduction',
      expect.objectContaining({ minRelevanceScore: 0.55, documentId: 'doc-a' }));
  });

  it('does not translate unrelated Hindi health questions', async () => {
    const { service, ai, retrieval } = build();
    expect(await service.maybeAnswer('मेरा सिर दर्द कर रहा है', identity, 'corr')).toBeNull();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });

  it('uses the selected response language ahead of a stored profile language', async () => {
    const { service } = build();
    const answer = await service.maybeAnswer('What does an ASHA worker do for NCD patients?',
      { ...identity, preferredLanguage: 'hi' }, 'corr', 'en');
    expect(answer?.content.summary).toContain('approved ASHA');
  });

  it.each([
    'Diabetes se bachav ke liye kya karna chahiye?',
    'BP ko control rakhne ke liye kya savdhani rakhein?',
    'Sugar ke patient ko khane-peene mein kya dhyan rakhna chahiye?',
    'Roz exercise karna kyun zaroori hai?',
    'Tobacco se health ko kya nuksan hota hai?',
    'High BP ka screening kyun hota hai?',
    'What does an ASHA worker do for NCD patients?',
  ])('routes confirmed education question through the ASHA evidence gate: %s', async (question) => {
    const { service, db, retrieval } = build();
    const answer = await service.maybeAnswer(question, identity, 'corr');
    expect(db.query).toHaveBeenCalled();
    expect(retrieval.retrieve).not.toHaveBeenCalled();
    expect(answer?.intent).toBe('ASHA_EDUCATION');
    expect(answer?.content.summary).toMatch(/approved ASHA|स्वीकृत आशा/);
  });
});
