import {
  enforceTenantFindOne,
  enforceTenantFindMany,
  TenantScopedEntity,
} from './tenant-isolation.utils';

interface MockEntity extends TenantScopedEntity {
  id: string;
  status?: string;
}

describe('Tenant Isolation Utilities', () => {
  const tenantId = 'tenant-uuid-123';

  it('should apply tenantId to empty findOne options', () => {
    const options = enforceTenantFindOne<MockEntity>(tenantId, {});
    expect(options.where).toEqual({ tenantId });
  });

  it('should apply tenantId alongside existing findOne where conditions', () => {
    const options = enforceTenantFindOne<MockEntity>(tenantId, {
      where: { id: 'entity-uuid' },
    });
    expect(options.where).toEqual({ id: 'entity-uuid', tenantId });
  });

  it('should apply tenantId to array of conditions in findMany options', () => {
    const options = enforceTenantFindMany<MockEntity>(tenantId, {
      where: [{ status: 'ACTIVE' }, { status: 'PENDING' }],
    });
    expect(options.where).toEqual([
      { status: 'ACTIVE', tenantId },
      { status: 'PENDING', tenantId },
    ]);
  });
});
