import { Injectable, Logger } from '@nestjs/common';
import { ConfigurationService } from '../configuration/configuration.service';

/**
 * MetricsService
 *
 * Exposes privacy-safe Prometheus operational counters and duration metrics.
 * PRIVACY MANDATE: Never include raw ABHA, patient IDs, phone/email, clinical values,
 * raw patient text queries, session IDs, correlation IDs, tokens, or raw tenant IDs as labels.
 * Only bounded, low-cardinality labels are allowed.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  private turnCounters: Map<string, number> = new Map();
  private safetyWithheldCounters: Map<string, number> = new Map();
  private aiRequestCounters: Map<string, number> = new Map();
  private abdmRequestCounters: Map<string, number> = new Map();
  private durationSum: Map<string, number> = new Map();
  private durationCount: Map<string, number> = new Map();

  constructor(private readonly configService: ConfigurationService) {}

  /**
   * Records a turn execution event with privacy-safe low-cardinality labels.
   */
  recordTurn(options: {
    intentCategory?: string;
    responseType?: string;
    safetyStatus?: string;
    durationMs?: number;
  }): void {
    if (!this.configService.metricsEnabled) return;

    try {
      const intent = this.sanitizeLabel(options.intentCategory, 'UNKNOWN');
      const responseType = this.sanitizeLabel(options.responseType, 'text');
      const safetyStatus = this.sanitizeLabel(options.safetyStatus, 'SAFE');

      const key = `intent="${intent}",response_type="${responseType}",safety_status="${safetyStatus}"`;
      this.turnCounters.set(key, (this.turnCounters.get(key) || 0) + 1);

      if (options.durationMs !== undefined && options.durationMs >= 0) {
        const durationSec = options.durationMs / 1000;
        const durKey = `status="success"`;
        this.durationSum.set(
          durKey,
          (this.durationSum.get(durKey) || 0) + durationSec,
        );
        this.durationCount.set(
          durKey,
          (this.durationCount.get(durKey) || 0) + 1,
        );
      }
    } catch (err: unknown) {
      // Fail silently to never impact clinical processing
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to record turn metric: ${msg}`);
    }
  }

  /**
   * Records a safety withheld event.
   */
  recordSafetyWithheld(category = 'MEDICAL_SAFETY'): void {
    if (!this.configService.metricsEnabled) return;

    try {
      const safeCat = this.sanitizeLabel(category, 'GENERAL');
      const key = `category="${safeCat}"`;
      this.safetyWithheldCounters.set(
        key,
        (this.safetyWithheldCounters.get(key) || 0) + 1,
      );
    } catch {
      // Ignore metric recording errors
    }
  }

  /**
   * Records AI provider requests.
   */
  recordAiRequest(providerType: string, status: 'success' | 'failure'): void {
    if (!this.configService.metricsEnabled) return;

    try {
      const provider = this.sanitizeLabel(providerType, 'DEV');
      const key = `provider="${provider}",status="${status}"`;
      this.aiRequestCounters.set(
        key,
        (this.aiRequestCounters.get(key) || 0) + 1,
      );
    } catch {
      // Ignore
    }
  }

  /**
   * Records ABDM record retrieval requests.
   */
  recordAbdmRequest(
    providerType: string,
    status: 'success' | 'fallback' | 'failure',
  ): void {
    if (!this.configService.metricsEnabled) return;

    try {
      const provider = this.sanitizeLabel(providerType, 'DEV');
      const key = `provider="${provider}",status="${status}"`;
      this.abdmRequestCounters.set(
        key,
        (this.abdmRequestCounters.get(key) || 0) + 1,
      );
    } catch {
      // Ignore
    }
  }

  /**
   * Records knowledge RAG retrieval requests.
   */
  recordKnowledgeRequest(options: {
    intentCategory?: string;
    providerType?: string;
    status?: string;
    durationMs?: number;
  }): void {
    if (!this.configService.metricsEnabled) return;

    try {
      const intent = this.sanitizeLabel(options.intentCategory, 'UNKNOWN');
      const provider = this.sanitizeLabel(options.providerType, 'DEV');
      const status = this.sanitizeLabel(options.status, 'SUCCESS');
      const key = `intent="${intent}",provider="${provider}",status="${status}"`;
      this.aiRequestCounters.set(
        key,
        (this.aiRequestCounters.get(key) || 0) + 1,
      );
    } catch {
      // Ignore
    }
  }

  /**
   * Generates standard Prometheus text format output.
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [
      '# HELP vda_turns_total Total number of conversation turns processed.',
      '# TYPE vda_turns_total counter',
    ];

    if (this.turnCounters.size === 0) {
      lines.push(
        'vda_turns_total{intent="UNKNOWN",response_type="text",safety_status="SAFE"} 0',
      );
    } else {
      for (const [labels, val] of this.turnCounters.entries()) {
        lines.push(`vda_turns_total{${labels}} ${val}`);
      }
    }

    lines.push('');
    lines.push(
      '# HELP vda_turn_duration_seconds Total duration of turn processing in seconds.',
    );
    lines.push('# TYPE vda_turn_duration_seconds summary');
    for (const [labels, sum] of this.durationSum.entries()) {
      const count = this.durationCount.get(labels) || 0;
      lines.push(`vda_turn_duration_seconds_sum{${labels}} ${sum.toFixed(4)}`);
      lines.push(`vda_turn_duration_seconds_count{${labels}} ${count}`);
    }
    if (this.durationSum.size === 0) {
      lines.push('vda_turn_duration_seconds_sum{status="success"} 0.0000');
      lines.push('vda_turn_duration_seconds_count{status="success"} 0');
    }

    lines.push('');
    lines.push(
      '# HELP vda_safety_withheld_total Total turns withheld by safety gate.',
    );
    lines.push('# TYPE vda_safety_withheld_total counter');
    if (this.safetyWithheldCounters.size === 0) {
      lines.push('vda_safety_withheld_total{category="GENERAL"} 0');
    } else {
      for (const [labels, val] of this.safetyWithheldCounters.entries()) {
        lines.push(`vda_safety_withheld_total{${labels}} ${val}`);
      }
    }

    lines.push('');
    lines.push('# HELP vda_ai_requests_total Total AI provider requests.');
    lines.push('# TYPE vda_ai_requests_total counter');
    if (this.aiRequestCounters.size === 0) {
      lines.push('vda_ai_requests_total{provider="DEV",status="success"} 0');
    } else {
      for (const [labels, val] of this.aiRequestCounters.entries()) {
        lines.push(`vda_ai_requests_total{${labels}} ${val}`);
      }
    }

    lines.push('');
    lines.push(
      '# HELP vda_abdm_requests_total Total health record retrieval requests.',
    );
    lines.push('# TYPE vda_abdm_requests_total counter');
    if (this.abdmRequestCounters.size === 0) {
      lines.push('vda_abdm_requests_total{provider="DEV",status="success"} 0');
    } else {
      for (const [labels, val] of this.abdmRequestCounters.entries()) {
        lines.push(`vda_abdm_requests_total{${labels}} ${val}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  private sanitizeLabel(val: string | undefined, fallback: string): string {
    if (!val || typeof val !== 'string') return fallback;
    // Keep alphanumeric and underscore only, max 32 chars to enforce bounded low cardinality
    const clean = val.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    return clean || fallback;
  }
}
