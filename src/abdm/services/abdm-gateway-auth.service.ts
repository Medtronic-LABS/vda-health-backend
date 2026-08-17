import { Injectable, Logger } from '@nestjs/common';
import { ConfigurationService } from '../../configuration/configuration.service';
import * as crypto from 'crypto';

export interface AbdmAuthTokenResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  tokenType?: string;
}

@Injectable()
export class AbdmGatewayAuthService {
  private readonly logger = new Logger(AbdmGatewayAuthService.name);

  private cachedAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private readonly config: ConfigurationService) {}

  /**
   * Returns a valid ABDM Gateway JWT Access Token.
   * Uses cached token if valid; otherwise fetches a new token.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    // Use cached token if it has at least 60 seconds of validity remaining
    if (this.cachedAccessToken && this.tokenExpiresAt > now + 60000) {
      return this.cachedAccessToken;
    }

    return this.authenticate();
  }

  /**
   * Invokes ABDM Gateway Session Auth API Section 3.2.1:
   * POST /api/hiecm/gateway/v3/sessions
   */
  async authenticate(): Promise<string> {
    const baseUrl = this.config.abdmBaseUrl;
    const clientId = this.config.abdmClientId;
    const clientSecret = this.config.abdmClientSecret;
    const xCmId = this.config.abdmXCmId;

    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error(
        'ABDM gateway authentication parameters (base URL, client ID, client secret) missing',
      );
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/hiecm/gateway/v3/sessions`;
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    this.logger.log(
      `[ABDM_AUTH] Requesting gateway session token for clientId=${clientId}`,
    );

    const controller = new AbortController();
    const timeoutMs = this.config.abdmTimeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'REQUEST-ID': requestId,
          TIMESTAMP: timestamp,
          'X-CM-ID': xCmId,
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          grantType: 'client_credentials',
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `[ABDM_AUTH] Failed status=${response.status} body=${errorText}`,
        );
        throw new Error(
          `ABDM Gateway Auth failed status=${response.status}: ${errorText}`,
        );
      }

      const data = (await response.json()) as AbdmAuthTokenResponse;
      if (!data.accessToken) {
        throw new Error('ABDM Gateway Auth response missing accessToken');
      }

      const expiresInSeconds = data.expiresIn || 1200;
      this.cachedAccessToken = data.accessToken;
      this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000;

      this.logger.log(
        `[ABDM_AUTH] Successfully authenticated. Token cached for ${expiresInSeconds}s`,
      );

      return data.accessToken;
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[ABDM_AUTH] Gateway authentication error: ${msg}`);
      throw err;
    }
  }

  /**
   * Resets cached token state (useful during testing or authentication failure retries).
   */
  clearCache(): void {
    this.cachedAccessToken = null;
    this.tokenExpiresAt = 0;
  }
}
