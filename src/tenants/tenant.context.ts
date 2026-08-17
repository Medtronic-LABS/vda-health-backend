import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private tenantId?: string;

  setTenantId(tenantId: string) {
    this.tenantId = tenantId;
  }

  getTenantId(): string {
    if (!this.tenantId) {
      throw new Error('Tenant context not initialized');
    }
    return this.tenantId;
  }
}
