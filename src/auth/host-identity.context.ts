import { Injectable } from '@nestjs/common';

export interface HostIdentity {
  partnerId: string;
  tenantId: string;
  externalId: string;
  subjectAbhaRef?: string;
  scopes: string[];
}

@Injectable()
export abstract class HostIdentityContext {
  abstract validateToken(token: string): Promise<HostIdentity>;
}
