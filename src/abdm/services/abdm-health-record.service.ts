import { Injectable, Logger } from '@nestjs/common';
import { ConfigurationService } from '../../configuration/configuration.service';
import { AbdmGatewayAuthService } from './abdm-gateway-auth.service';
import { AbdmEcdhService, KeyPairResult } from './abdm-ecdh.service';
import { FhirNormalizerService } from './fhir-normalizer.service';
import {
  IHealthRecordService,
  HealthRecordRequest,
  HealthRecordResult,
  RawHealthRecordBundle,
  HealthRecordCategory,
} from '../interfaces/health-record-service.interface';
import * as crypto from 'crypto';

@Injectable()
export class AbdmHealthRecordService implements IHealthRecordService {
  private readonly logger = new Logger(AbdmHealthRecordService.name);

  // In-memory store for pending async HIU transactions: transactionId -> KeyPair & Bundles
  private readonly activeTransactions = new Map<
    string,
    {
      keyPair: KeyPairResult;
      consentId: string;
      categories: HealthRecordCategory[];
      bundles: RawHealthRecordBundle[];
      completed: boolean;
      createdAt: Date;
    }
  >();

  constructor(
    private readonly config: ConfigurationService,
    private readonly authService: AbdmGatewayAuthService,
    private readonly ecdhService: AbdmEcdhService,
    private readonly fhirNormalizer: FhirNormalizerService,
  ) {}

  async fetchRecords(
    request: HealthRecordRequest,
  ): Promise<HealthRecordResult> {
    const { subjectContext, categories } = request;
    const baseUrl = this.config.abdmBaseUrl;
    const clientId = this.config.abdmClientId;
    const clientSecret = this.config.abdmClientSecret;
    const hiuId = this.config.abdmHiuId;

    this.logger.log(
      `[ABDM_PRODUCTION] fetchRecords requested for sessionId=${subjectContext.sessionId} categories=${categories.join(',')}`,
    );

    // Verify minimum required ABDM production configuration
    if (!baseUrl || !clientId || !clientSecret || !hiuId) {
      this.logger.warn(
        `[ABDM_PRODUCTION] ABDM configuration incomplete. Missing base URL, client ID, client secret, or HIU ID.`,
      );
      return {
        bundles: [],
        unavailableCategories: categories,
        providerErrorCodes: ['ABDM_CONFIGURATION_INCOMPLETE'],
      };
    }

    let attempt = 0;
    const maxRetries = this.config.abdmMaxRetries || 2;
    const timeoutMs = this.config.abdmTimeoutMs || 10000;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Step 1: Authenticate & Obtain ABDM Gateway Session Token
        const accessToken = await this.authService.getAccessToken();

        // Step 2: Generate Curve25519 Ephemeral Key pair for HIU Request
        const keyPair = this.ecdhService.generateKeyPair(24);

        // Step 3: Initiate Health Information Request (Section 5.3.1)
        const consentId =
          subjectContext.abdmConsentArtefactRef || 'dev-consent-artifact-001';

        const { transactionId } = await this.requestHealthInformation({
          baseUrl,
          hiuId,
          accessToken,
          consentId,
          categories,
          keyPair,
          dateRangeStart: request.dateRangeStart,
          dateRangeEnd: request.dateRangeEnd,
          signal: controller.signal,
        });

        clearTimeout(timer);

        // Store transaction state for callback processing
        this.activeTransactions.set(transactionId, {
          keyPair,
          consentId,
          categories,
          bundles: [],
          completed: false,
          createdAt: new Date(),
        });

        this.logger.log(
          `[ABDM_PRODUCTION] Health information requested successfully. Assigned transactionId=${transactionId}`,
        );

        // Return initial request result (asynchronous data flow handles push entries)
        return {
          bundles: [],
          unavailableCategories: [],
          providerErrorCodes: [],
        };
      } catch (err: unknown) {
        clearTimeout(timer);
        const errMsg = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(errMsg);
        this.logger.warn(
          `[ABDM_PRODUCTION] Attempt ${attempt}/${maxRetries} failed: ${errMsg}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 200),
          );
        }
      }
    }

    this.logger.error(
      `[ABDM_PRODUCTION] ABDM fetch failed after ${maxRetries} retries: ${lastError?.message}`,
    );

    return {
      bundles: [],
      unavailableCategories: categories,
      providerErrorCodes: [lastError?.message || 'ABDM_FETCH_FAILED'],
    };
  }

  /**
   * Section 5.3.1: Data flow — Data request invoked by HIU
   * POST /api/hiecm/data-flow/v3/health-information/request
   */
  private async requestHealthInformation(options: {
    baseUrl: string;
    hiuId: string;
    accessToken: string;
    consentId: string;
    categories: HealthRecordCategory[];
    keyPair: KeyPairResult;
    dateRangeStart?: Date;
    dateRangeEnd?: Date;
    signal: AbortSignal;
  }): Promise<{ transactionId: string }> {
    const { baseUrl, hiuId, accessToken, consentId, keyPair, signal } = options;
    const url = `${baseUrl.replace(/\/+$/, '')}/api/hiecm/data-flow/v3/health-information/request`;
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const xCmId = this.config.abdmXCmId;
    const dataPushUrl = `${this.config.abdmCallbackUrl.replace(/\/+$/, '')}/api/v3/hiu/data/notification`;

    const fromDate = options.dateRangeStart
      ? options.dateRangeStart.toISOString()
      : new Date(Date.now() - 365 * 86400000).toISOString();
    const toDate = options.dateRangeEnd
      ? options.dateRangeEnd.toISOString()
      : new Date().toISOString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'REQUEST-ID': requestId,
        TIMESTAMP: timestamp,
        'X-CM-ID': xCmId,
        'X-HIU-ID': hiuId,
      },
      body: JSON.stringify({
        hiRequest: {
          consent: { id: consentId },
          dateRange: {
            from: fromDate,
            to: toDate,
          },
          dataPushUrl,
          keyMaterial: keyPair.keyMaterial,
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `ABDM Data Request failed status=${response.status}: ${errText}`,
      );
    }

    return { transactionId: requestId };
  }

  /**
   * Processes pushed encrypted health entries received at the HIU Data Push Endpoint:
   * POST /api/v3/hiu/data/notification (Section 6.3.5 / Section 5.3.3)
   */
  async processPushedDataNotification(payload: {
    transactionId: string;
    pageNumber: number;
    pageCount: number;
    entries: Array<{
      content: string;
      media: string;
      checksum?: string;
      careContextReference?: string;
    }>;
    keyMaterial?: {
      cryptoAlg: string;
      curve: string;
      dhPublicKey: { keyValue: string };
      nonce: string;
    };
  }): Promise<{ status: string }> {
    const { transactionId, entries, keyMaterial } = payload;
    this.logger.log(
      `[HIU_DATA_PUSH] Received data push notification transactionId=${transactionId} entriesCount=${entries.length}`,
    );

    const txState = this.activeTransactions.get(transactionId);
    const hiuPrivateKeyBase64 = txState?.keyPair.privateKeyBase64 || '';
    const hiuNonceBase64 = txState?.keyPair.nonceBase64 || '';

    for (const entry of entries) {
      let decryptedText = '';
      if (keyMaterial && hiuPrivateKeyBase64) {
        decryptedText = this.ecdhService.decryptPayload({
          encryptedContentBase64: entry.content,
          hiuPrivateKeyBase64,
          senderPublicKeyBase64: keyMaterial.dhPublicKey.keyValue,
          hiuNonceBase64,
          senderNonceBase64: keyMaterial.nonce,
        });
      } else {
        // Direct Base64 UTF-8 decode
        decryptedText = Buffer.from(entry.content, 'base64').toString('utf8');
      }

      // Parse FHIR resource into RawHealthRecordBundle
      const bundle = this.fhirNormalizer.normalizeFhirBundle(
        decryptedText,
        HealthRecordCategory.MEDICATION,
        entry.careContextReference || 'ABDM-HIP',
      );

      if (txState) {
        txState.bundles.push(bundle);
      }
    }

    if (txState) {
      txState.completed = true;
    }

    // Acknowledge data transfer to HIE-CM (Section 5.3.3 / 6.3.6)
    await this.notifyDataTransferStatus(
      transactionId,
      txState?.consentId || '',
    );

    return { status: 'RECEIVED' };
  }

  /**
   * Section 5.3.3 / 6.3.6: Notify HIE-CM of data transfer status
   * POST /api/hiecm/data-flow/v3/health-information/notify
   */
  private async notifyDataTransferStatus(
    transactionId: string,
    consentId: string,
  ): Promise<void> {
    const baseUrl = this.config.abdmBaseUrl;
    const hiuId = this.config.abdmHiuId;
    if (!baseUrl || !hiuId) return;

    try {
      const accessToken = await this.authService.getAccessToken();
      const url = `${baseUrl.replace(/\/+$/, '')}/api/hiecm/data-flow/v3/health-information/notify`;

      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'REQUEST-ID': crypto.randomUUID(),
          TIMESTAMP: new Date().toISOString(),
          'X-CM-ID': this.config.abdmXCmId,
          'X-HIU-ID': hiuId,
        },
        body: JSON.stringify({
          notification: {
            consentId,
            transactionId,
            doneAt: new Date().toISOString(),
            notifier: { type: 'HIU', id: hiuId },
            statusNotification: {
              sessionStatus: 'TRANSFERRED',
              hipId: 'ABDM_HIP',
              statusResponses: [
                {
                  careContextReference: 'CC-001',
                  hiStatus: 'OK',
                  description: 'Care Management',
                },
              ],
            },
          },
        }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[ABDM_NOTIFY] Failed to notify data transfer: ${msg}`);
    }
  }

  getTransactionState(transactionId: string) {
    return this.activeTransactions.get(transactionId);
  }
}
