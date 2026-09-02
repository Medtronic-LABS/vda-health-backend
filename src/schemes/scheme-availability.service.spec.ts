import { AiOrchestratorService } from '../ai/orchestration/ai-orchestrator.service';
import { SchemeService } from './scheme.service';

describe('source-backed state scheme availability', () => {
  it('returns every matching authorised scheme for a state inventory', async () => {
    const rows = [
      { name: 'Scheme A', geographyScope: 'STATE', state: 'STATE_A', active: true },
      { name: 'Scheme B', geographyScope: 'STATE', state: 'STATE_A', active: true },
    ];
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    const service = new SchemeService(
      { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) } as any,
      {} as any,
    );

    await expect(service.list('tenant-a', { state: 'STATE_A' })).resolves.toEqual(rows);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(scheme."geographyScope" = :national OR LOWER(scheme.state) = LOWER(:state))',
      { national: 'NATIONAL', state: 'STATE_A' },
    );
  });

  it('does not truncate the structured source inventory for availability', () => {
    const orchestrator = new (AiOrchestratorService as any)();
    const facts = orchestrator.scopedSchemeFacts([
      { name: 'Scheme A', geographyScope: 'STATE', state: 'STATE_A' },
      { name: 'Scheme B', geographyScope: 'STATE', state: 'STATE_A' },
      { name: 'Scheme C', geographyScope: 'STATE', state: 'STATE_A' },
      { name: 'Scheme D', geographyScope: 'STATE', state: 'STATE_A' },
    ], 'SCHEME_AVAILABILITY');

    expect(facts).toContain('Scheme: Scheme A');
    expect(facts).toContain('Scheme: Scheme B');
    expect(facts).toContain('Scheme: Scheme C');
    expect(facts).toContain('Scheme: Scheme D');
  });
});
