import { VoiceService } from '../voice.service';
import { SarvamTtsProvider } from './sarvam-tts.provider';

describe('TTS provider payload', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  it('sends sanitized speech to the configured provider without changing values or warnings', async () => {
    const synthesize = jest.fn().mockResolvedValue({ audioBuffer: Buffer.from('audio'), mimeType: 'audio/mpeg', model: 'bulbul:v3' });
    const service = new VoiceService({ voiceTtsProvider: 'sarvam', voiceTtsFallbackEnabled: false } as any,
      {} as any, {} as any, {} as any, { synthesize } as any);
    await service.synthesize({ text: '**PM-JAY**: HbA1c 6.2%, Glucose 245 mg/dL. https://example.invalid\nतुरंत अस्पताल जाएँ।',
      languageCode: 'hi-IN' });
    expect(synthesize).toHaveBeenCalledTimes(1);
    const payload = synthesize.mock.calls[0][0];
    expect(payload.text).toContain('आयुष्मान भारत योजना');
    expect(payload.text).toContain('245 mg/dL');
    expect(payload.text).toContain('6.2%');
    expect(payload.text).toContain('तुरंत अस्पताल जाएँ');
    expect(payload.text).not.toContain('https://');
  });

  it('passes the cleaned text into the actual Sarvam request body', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true,
      json: async () => ({ audios: [Buffer.from('synthetic audio').toString('base64')] }) });
    global.fetch = request as typeof fetch;
    const config = { voiceTtsProvider: 'sarvam', voiceTtsFallbackEnabled: false, sarvamEnabled: true,
      sarvamApiKey: 'synthetic-key', sarvamBaseUrl: 'https://example.invalid',
      sarvamBulbulTtsModel: 'bulbul:v3', sarvamTimeoutMs: 1000 } as any;
    const service = new VoiceService(config, {} as any, {} as any, {} as any, new SarvamTtsProvider(config));
    await service.synthesize({ text: 'PM-JAY के बारे में https://example.invalid देखें। Glucose 245 mg/dL।', languageCode: 'hi-IN' });
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.text).toContain('आयुष्मान भारत योजना');
    expect(body.text).toContain('245 mg/dL');
    expect(body.text).not.toContain('https://');
    expect(body.language_code).toBe('hi-IN');
  });
});
