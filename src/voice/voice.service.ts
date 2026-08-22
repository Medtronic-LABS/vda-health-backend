import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigurationService } from '../configuration/configuration.service';
import { STTProvider, STTRequest, STTResponse } from '../ai/interfaces/stt-provider.interface';
import { TTSProvider, TTSRequest, TTSResponse } from '../ai/interfaces/tts-provider.interface';

@Injectable()
export class VoiceService implements STTProvider, TTSProvider {
  constructor(private readonly config: ConfigurationService) {}

  async transcribe(request: STTRequest): Promise<STTResponse> {
    this.requireConfigured();
    if (!request.audioBuffer?.length) {
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(request.audioBuffer)], { type: request.mimeType || 'audio/webm' }),
      'recording.webm',
    );
    form.append('model', this.config.sarvamSaarasSttModel || 'saaras:v3');
    form.append('mode', 'transcribe');
    if (request.languageHint) form.append('language_code', request.languageHint);

    const response = await this.request('/speech-to-text', { method: 'POST', body: form });
    const data = (await response.json()) as { transcript?: string };
    const transcript = data.transcript?.trim();
    if (!transcript) throw new ServiceUnavailableException('Voice service is currently unavailable.');
    return { transcript };
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    this.requireConfigured();
    const text = request.text?.trim();
    if (!text || text.length > 2500) {
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    }
    const response = await this.request('/text-to-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language_code: request.languageCode || 'hi-IN',
        model: this.config.sarvamBulbulTtsModel || 'bulbul:v3',
        speaker: request.voiceId || 'shubh',
        output_audio_codec: 'mp3',
      }),
    });
    const data = (await response.json()) as { audios?: string[] };
    const encoded = data.audios?.[0];
    if (!encoded) throw new ServiceUnavailableException('Voice service is currently unavailable.');
    return { audioBuffer: Buffer.from(encoded, 'base64'), mimeType: 'audio/mpeg' };
  }

  isAvailable(): boolean {
    return this.config.sarvamEnabled && Boolean(this.config.sarvamApiKey);
  }

  private requireConfigured(): void {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Voice service is currently unavailable.');
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.sarvamTimeoutMs);
    try {
      const response = await fetch(`${this.config.sarvamBaseUrl}${path}`, {
        ...init,
        headers: { 'api-subscription-key': this.config.sarvamApiKey!, ...(init.headers || {}) },
        signal: controller.signal,
      });
      if (!response.ok) throw new ServiceUnavailableException('Voice service is currently unavailable.');
      return response;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}
