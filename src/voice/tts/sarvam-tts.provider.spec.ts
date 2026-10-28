import { SarvamTtsProvider } from './sarvam-tts.provider';

describe('Sarvam patient voice settings', () => {
  const originalFetch = global.fetch;

  afterEach(() => { global.fetch = originalFetch; });

  it('passes a supported voice and measured pace to Bulbul v3', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true,
      json: async () => ({ audios: [Buffer.from('synthetic audio').toString('base64')] }) });
    global.fetch = request as typeof fetch;
    const provider = new SarvamTtsProvider({ sarvamEnabled: true, sarvamApiKey: 'synthetic-key',
      sarvamBaseUrl: 'https://example.invalid', sarvamBulbulTtsModel: 'bulbul:v3', sarvamTimeoutMs: 1000 } as any);
    const result = await provider.synthesize({ text: 'नमस्ते', languageCode: 'hi-IN', voiceId: 'priya', pace: 0.9 });
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body).toEqual(expect.objectContaining({ speaker: 'priya', pace: 0.9,
      language_code: 'hi-IN', model: 'bulbul:v3' }));
    expect(result.audioBuffer.toString()).toBe('synthetic audio');
  });

  it('does not pass v3 voice names to another configured model', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true,
      json: async () => ({ audios: [Buffer.from('audio').toString('base64')] }) });
    global.fetch = request as typeof fetch;
    const provider = new SarvamTtsProvider({ sarvamEnabled: true, sarvamApiKey: 'synthetic-key',
      sarvamBaseUrl: 'https://example.invalid', sarvamBulbulTtsModel: 'bulbul:v2', sarvamTimeoutMs: 1000 } as any);
    await provider.synthesize({ text: 'Hello', languageCode: 'en-IN', voiceId: 'ishita', pace: 0.9 });
    expect(JSON.parse(request.mock.calls[0][1].body).speaker).toBe('shubh');
  });
});
