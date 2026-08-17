import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AbdmHealthRecordService } from '../services/abdm-health-record.service';

@Controller('api/v3/hiu')
export class AbdmHiuCallbackController {
  private readonly logger = new Logger(AbdmHiuCallbackController.name);

  constructor(
    private readonly abdmHealthRecordService: AbdmHealthRecordService,
  ) {}

  /**
   * Section 4.3.2: HIE-CM Callback to HIU for Consent Request Init
   * POST /api/v3/hiu/consent/request/on-init
   */
  @Post('consent/request/on-init')
  @HttpCode(HttpStatus.ACCEPTED)
  handleConsentInitCallback(
    @Headers('request-id') requestId: string,
    @Body() body?: Record<string, unknown>,
  ): Record<string, unknown> {
    this.logger.log(
      `[HIU_CALLBACK] Consent init callback received requestId=${requestId} keys=${Object.keys(body || {}).join(',')}`,
    );
    return { status: 'ACCEPTED', requestId };
  }

  /**
   * Section 4.3.3: HIE-CM Callback to HIU when Consent is APPROVED/REVOKED/DENIED
   * POST /api/v3/hiu/consent/request/notify
   */
  @Post('consent/request/notify')
  @HttpCode(HttpStatus.ACCEPTED)
  handleConsentNotifyCallback(
    @Headers('request-id') requestId: string,
    @Body() body?: Record<string, unknown>,
  ): Record<string, unknown> {
    this.logger.log(
      `[HIU_CALLBACK] Consent notification callback received requestId=${requestId} keys=${Object.keys(body || {}).join(',')}`,
    );
    return { status: 'ACCEPTED', requestId };
  }

  /**
   * Section 4.3.8: HIE-CM Callback to HIU with Consent Artefact Details
   * POST /api/v3/hiu/consent/on-fetch
   */
  @Post('consent/on-fetch')
  @HttpCode(HttpStatus.ACCEPTED)
  handleConsentOnFetchCallback(
    @Headers('request-id') requestId: string,
    @Body() body?: Record<string, unknown>,
  ): Record<string, unknown> {
    this.logger.log(
      `[HIU_CALLBACK] Consent on-fetch callback received requestId=${requestId} keys=${Object.keys(body || {}).join(',')}`,
    );
    return { status: 'ACCEPTED', requestId };
  }

  /**
   * Section 5.3.2: HIE-CM Callback to HIU for Health Information Request Acknowledgment
   * POST /api/v3/hiu/health-information/on-request
   */
  @Post('health-information/on-request')
  @HttpCode(HttpStatus.ACCEPTED)
  handleHealthInfoOnRequestCallback(
    @Headers('request-id') requestId: string,
    @Body() body?: Record<string, unknown>,
  ): Record<string, unknown> {
    this.logger.log(
      `[HIU_CALLBACK] Health info on-request callback received requestId=${requestId} keys=${Object.keys(body || {}).join(',')}`,
    );
    return { status: 'ACCEPTED', requestId };
  }

  /**
   * Section 5.3.3 / 6.3.5: Data Push Receiver URL called by HIP to push encrypted health entries
   * POST /api/v3/hiu/data/notification
   */
  @Post('data/notification')
  @HttpCode(HttpStatus.ACCEPTED)
  async handleDataPushNotification(
    @Headers('request-id') requestId: string,
    @Body()
    body: {
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
    },
  ): Promise<Record<string, unknown>> {
    this.logger.log(
      `[HIU_CALLBACK] Data push notification received transactionId=${body?.transactionId}`,
    );
    if (body?.transactionId && body?.entries) {
      await this.abdmHealthRecordService.processPushedDataNotification(body);
    }
    return { status: 'ACCEPTED', requestId };
  }
}
