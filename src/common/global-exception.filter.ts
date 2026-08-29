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
        'TOO_MANY_REQUESTS',
        'RATE_LIMITER_UNAVAILABLE',
        'PRESCRIPTION_EXTRACTION_FAILED',
        'GEMINI_UNAVAILABLE',
        'UNSUPPORTED_FILE',
        'INVALID_FILE',
        'ORCHESTRATION_FAILED',
        'KNOWLEDGE_SERVICE_UNAVAILABLE',
        'PRESCRIPTION_SERVICE_UNAVAILABLE',
        'NO_PATIENT_DATA',
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
        } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
          code = 'TOO_MANY_REQUESTS';
        } else if (status === HttpStatus.SERVICE_UNAVAILABLE) {
          code = 'RATE_LIMITER_UNAVAILABLE';
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
      TOO_MANY_REQUESTS: {
        en: 'Too many requests. Please slow down and try again later.',
        hi: 'बहुत अधिक अनुरोध। कृपया गति धीमी करें और बाद में पुनः प्रयास करें।',
      },
      RATE_LIMITER_UNAVAILABLE: {
        en: 'Rate limiter service is currently unavailable. Please try again later.',
        hi: 'दर सीमक सेवा वर्तमान में उपलब्ध नहीं है। कृपया बाद में पुनः प्रयास करें।',
      },
      PRESCRIPTION_EXTRACTION_FAILED: {
        en: 'We could not read this prescription confidently. Please upload a clearer image or PDF.',
        hi: 'हम इस पर्चे को भरोसे के साथ नहीं पढ़ सके। कृपया अधिक स्पष्ट फोटो या PDF अपलोड करें।',
      },
      GEMINI_UNAVAILABLE: {
        en: 'Prescription reading service is temporarily unavailable. Please try again.',
        hi: 'पर्चा पढ़ने की सेवा अस्थायी रूप से उपलब्ध नहीं है। कृपया दोबारा प्रयास करें।',
      },
      UNSUPPORTED_FILE: {
        en: 'Please upload a supported PDF, image, TXT, or Markdown file.',
        hi: 'कृपया समर्थित PDF, फोटो, TXT या Markdown फ़ाइल अपलोड करें।',
      },
      INVALID_FILE: {
        en: 'The selected file is empty or invalid. Please choose another file.',
        hi: 'चुनी गई फ़ाइल खाली या अमान्य है। कृपया दूसरी फ़ाइल चुनें।',
      },
      INTERNAL_SERVER_ERROR: {
        en: 'A temporary system issue occurred. Please try again later.',
        hi: 'एक अस्थायी सिस्टम समस्या उत्पन्न हुई। कृपया बाद में पुनः प्रयास करें।',
      },
      ORCHESTRATION_FAILED: {
        en: 'Unable to process your request.',
        hi: 'आपके अनुरोध पर कार्रवाई करने में असमर्थ।',
      },
      KNOWLEDGE_SERVICE_UNAVAILABLE: {
        en: 'Knowledge service is temporarily unavailable.',
        hi: 'ज्ञान सेवा अस्थायी रूप से उपलब्ध नहीं है।',
      },
      PRESCRIPTION_SERVICE_UNAVAILABLE: {
        en: 'Prescription service is temporarily unavailable.',
        hi: 'पर्चा सेवा अस्थायी रूप से उपलब्ध नहीं है।',
      },
      NO_PATIENT_DATA: {
        en: 'This information is not available in your records.',
        hi: 'यह जानकारी आपके रिकॉर्ड में उपलब्ध नहीं है।',
      },
    };

    const patientSafeMessage =
      patientSafeMessages[code] || patientSafeMessages.INTERNAL_SERVER_ERROR;

    const errorPayload = {
      error: {
        code,
        message: patientSafeMessage.en,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        retryable:
          code === 'UPSTREAM_TIMEOUT' ||
          code === 'PRESCRIPTION_EXTRACTION_FAILED' ||
          code === 'GEMINI_UNAVAILABLE' ||
          status >= 500,
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
