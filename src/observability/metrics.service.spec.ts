import { MetricsService } from './metrics.service';
import { ConfigurationService } from '../configuration/configuration.service';

describe('MetricsService Unit Tests', () => {
  let service: MetricsService;
  let mockConfigService: { metricsEnabled: boolean };

  beforeEach(() => {
    mockConfigService = {
      metricsEnabled: true,
    };
    service = new MetricsService(
      mockConfigService as unknown as ConfigurationService,
    );
  });

  it('should record turn metrics and generate valid Prometheus output', () => {
    service.recordTurn({
      intentCategory: 'MEDICATION_QUERY',
      responseType: 'text',
      safetyStatus: 'SAFE',
      durationMs: 120,
    });

    const output = service.getPrometheusMetrics();
    expect(output).toContain('vda_turns_total');
    expect(output).toContain('intent="MEDICATION_QUERY"');
    expect(output).toContain('response_type="text"');
    expect(output).toContain('safety_status="SAFE"');
    expect(output).toContain('vda_turn_duration_seconds');
  });

  it('should never contain raw PII or secret tokens in metric output', () => {
    service.recordTurn({
      intentCategory: 'user@example.com <script>alert(1)</script>',
      responseType: 'text',
      safetyStatus: 'SAFE',
    });

    const output = service.getPrometheusMetrics();
    expect(output).not.toContain('user@example.com');
    expect(output).not.toContain('<script>');
  });

  it('should record safety withheld metrics', () => {
    service.recordSafetyWithheld('UNSAFE_MEDICATION');
    const output = service.getPrometheusMetrics();
    expect(output).toContain('vda_safety_withheld_total');
    expect(output).toContain('category="UNSAFE_MEDICATION"');
  });

  it('should return empty/default metric lines when disabled', () => {
    mockConfigService.metricsEnabled = false;
    service.recordTurn({ intentCategory: 'MEDICATION_QUERY' });
    const output = service.getPrometheusMetrics();
    expect(output).toContain('vda_turns_total');
  });
});
