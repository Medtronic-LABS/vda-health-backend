import { Injectable } from '@nestjs/common';

export interface HostIdentity {
  partnerId: string;
  tenantId: string;
  externalId: string;
  subjectAbhaRef?: string;
  scopes: string[];
  authType?: 'DEV' | 'MOBILE';
  workerRole?: 'ASHA' | 'ANM' | 'CHO';
  mobileUserId?: string;
  preferredLanguage?: string;
}

@Injectable()
export abstract class HostIdentityContext {
  abstract validateToken(token: string): Promise<HostIdentity>;
}
