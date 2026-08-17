import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigurationService } from '../configuration/configuration.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly configService: ConfigurationService) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Record<string, unknown>>();

    const correlationId = (request['correlationId'] as string) || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred.';
    let detail = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseObj = exception.getResponse();

      if (typeof responseObj === 'string') {
        message = responseObj;
      } else if (typeof responseObj === 'object' && responseObj !== null) {
        const obj = responseObj as Record<string, unknown>;
        message =
          (obj['message'] as string | undefined) ||
          (exception as Error).message;
        detail = (obj['detail'] as Record<string, unknown> | undefined) || obj;
      }

      // Extract specific codes from exception messages
      const possibleCodes = [
        'CONSENT_MISSING',
        'SESSION_NOT_FOUND',
        'SESSION_EXPIRED',
        'SESSION_CLOSED',
        'INVALID_SPEAKER',
        'INVALID_ASSIST_CONTEXT',
        'TENANT_ACCESS_DENIED',
        'IDEMPOTENCY_CONFLICT',
        'INVALID_REQUEST',
        'UPSTREAM_TIMEOUT',
      ];

      // If the message or error matches one of these public codes, use it
      const matchedCode = possibleCodes.find(
        (c) =>
          message === c ||
          (exception.message && exception.message.includes(c)) ||
          (typeof responseObj === 'object' &&
            responseObj !== null &&
            (responseObj as Record<string, unknown>)['error'] === c),
      );

      if (matchedCode) {
        code = matchedCode;
      } else {
        // Fallback standard mappings based on status code
        if (status === HttpStatus.UNAUTHORIZED) {
          code = 'TENANT_ACCESS_DENIED';
        } else if (status === HttpStatus.FORBIDDEN) {
          code = 'TENANT_ACCESS_DENIED';
        } else if (status === HttpStatus.NOT_FOUND) {
          code = 'SESSION_NOT_FOUND';
        } else if (status === HttpStatus.CONFLICT) {
          code = 'IDEMPOTENCY_CONFLICT';
        } else if (status === HttpStatus.BAD_REQUEST) {
          code = 'INVALID_REQUEST';
        } else if (status === HttpStatus.GATEWAY_TIMEOUT) {
          code = 'UPSTREAM_TIMEOUT';
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Override HTTP status for SESSION_EXPIRED
    if (code === 'SESSION_EXPIRED') {
      status = this.configService.sessionExpiredHttpStatus || 410;
    }

    // Populate patient safe messages
    const patientSafeMessages: Record<string, { hi: string; en: string }> = {
      CONSENT_MISSING: {
        en: 'Patient consent is required to proceed.',
        hi: 'आगे बढ़ने के लिए मरीज की सहमति आवश्यक है।',
      },
      SESSION_NOT_FOUND: {
        en: 'The requested session was not found.',
        hi: 'अनुरोधित सत्र नहीं मिला।',
      },
      SESSION_EXPIRED: {
        en: 'Your active session has expired. Please start a new session.',
        hi: 'आपका सक्रिय सत्र समाप्त हो गया है। कृपया एक नया सत्र शुरू करें।',
      },
      SESSION_CLOSED: {
        en: 'This session has already been closed.',
        hi: 'यह सत्र पहले ही बंद कर दिया गया है।',
      },
      INVALID_SPEAKER: {
        en: 'The specified speaker profile is invalid.',
        hi: 'निर्दिष्ट वक्ता प्रोफ़ाइल अमान्य है।',
      },
      INVALID_ASSIST_CONTEXT: {
        en: 'Assisted conversation requires operational context parameter.',
        hi: 'सहायता प्राप्त बातचीत के लिए परिचालन संदर्भ पैरामीटर की आवश्यकता होती है।',
      },
      TENANT_ACCESS_DENIED: {
        en: 'Access denied for the requested tenant or subject.',
        hi: 'अनुरोधित किरायेदार या विषय के लिए पहुंच अस्वीकृत।',
      },
      IDEMPOTENCY_CONFLICT: {
        en: 'An operations conflict occurred due to duplicate request parameters.',
        hi: 'समान अनुरोध मापदंडों के कारण परिचालन संघर्ष हुआ।',
      },
      INVALID_REQUEST: {
        en: 'The request parameters are invalid or missing.',
        hi: 'अनुरोध मापदंड अमान्य या गायब हैं।',
      },
      UPSTREAM_TIMEOUT: {
        en: 'Request processing timed out. Please retry.',
        hi: 'अनुरोध प्रसंस्करण का समय समाप्त हो गया। कृपया पुनः प्रयास करें।',
      },
      INTERNAL_SERVER_ERROR: {
        en: 'A temporary system issue occurred. Please try again later.',
        hi: 'एक अस्थायी सिस्टम समस्या उत्पन्न हुई। कृपया बाद में पुनः प्रयास करें।',
      },
    };

    const patientSafeMessage =
      patientSafeMessages[code] || patientSafeMessages.INTERNAL_SERVER_ERROR;

    const errorPayload = {
      error: {
        code,
        message: patientSafeMessage.en,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        retryable: code === 'UPSTREAM_TIMEOUT' || status >= 500,
        patient_safe_message: patientSafeMessage,
        correlation_id: correlationId,
        detail: detail || {},
      },
    };

    this.logger.error(
      `VDA Error: code=${code} status=${status} correlationId=${correlationId} message=${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(errorPayload);
  }
}
