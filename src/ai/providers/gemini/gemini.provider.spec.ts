import { GeminiProvider } from './gemini.provider';

const jsonResponse = (body: string) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: body }] } }], usageMetadata: {} }) });
const errorResponse = (status: number) => ({ ok: false, status, json: async () => ({}) });

function config(keys: Array<{ slot: number; key: string }>) {
  return { geminiApiKeys: keys, geminiModel: 'gemini-3.5-flash', geminiTimeoutMs: 100, geminiMaxRetries: 1, geminiKeyCooldownSeconds: 60 } as any;
}

describe('GeminiProvider key failover', () => {
  const valid = '{"summary":"Short answer","sections":[],"cards":[],"actions":[]}';
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('uses the primary key when it succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(valid)) as any;
    const provider = new GeminiProvider(config([{ slot: 1, key: 'one' }]));
    await expect(provider.generate('x', { responseFormat: 'json' })).resolves.toMatchObject({ json: { summary: 'Short answer' } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails over from 429 to the next configured key', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(errorResponse(429)).mockResolvedValueOnce(jsonResponse(valid)) as any;
    const provider = new GeminiProvider(config([{ slot: 1, key: 'one' }, { slot: 2, key: 'two' }]));
    await expect(provider.generate('x', { responseFormat: 'json' })).resolves.toMatchObject({ json: { summary: 'Short answer' } });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not rotate keys for a request error', async () => {
    global.fetch = jest.fn().mockResolvedValue(errorResponse(400)) as any;
    const provider = new GeminiProvider(config([{ slot: 1, key: 'one' }, { slot: 2, key: 'two' }]));
    await expect(provider.generate('x')).rejects.toThrow('status 400');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('parses a markdown-wrapped valid JSON transport payload', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse('```json\n' + valid + '\n```')) as any;
    const provider = new GeminiProvider(config([{ slot: 1, key: 'one' }]));
    await expect(provider.generate('x', { responseFormat: 'json' })).resolves.toMatchObject({ json: { summary: 'Short answer' } });
  });
});
