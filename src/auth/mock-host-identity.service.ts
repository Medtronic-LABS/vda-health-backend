import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HostIdentity, HostIdentityContext } from './host-identity.context';
import { ConfigurationService } from '../configuration/configuration.service';

@Injectable()
export class MockHostIdentityService extends HostIdentityContext {
  constructor(private readonly configService: ConfigurationService) {
    super();
  }

  async validateToken(token: string): Promise<HostIdentity> {
    await Promise.resolve();

    // Verify development mode is explicitly enabled
    if (!this.configService.devAuthEnabled) {
      throw new UnauthorizedException(
        'Development authentication is disabled.',
      );
    }

    // Verify token matches configured dev-token
    const expectedToken = this.configService.devAuthToken || 'dev-token';
    if (token !== expectedToken) {
      throw new UnauthorizedException('Invalid mock authorization token.');
    }

    const partnerId = this.configService.devAuthPartnerId || 'dev-partner';
    const tenantId =
      this.configService.devAuthTenantId ||
      '00000000-0000-0000-0000-000000000000';
    const externalId = this.configService.devAuthExternalId || 'dev-host-user';
    const subjectAbhaRef =
      this.configService.devAuthSubjectAbhaRef || 'dev-subject-abha-ref';

    return {
      partnerId,
      tenantId,
      externalId,
      subjectAbhaRef,
      scopes: ['record_read', 'conversation_retention', 'reminder_delivery'],
    };
  }
}
