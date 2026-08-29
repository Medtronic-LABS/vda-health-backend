import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { HostIdentity } from '../auth/host-identity.context';
import { ConfigurationService } from '../configuration/configuration.service';

/** Limits operational review to the development admin or a host-provided review scope. */
@Injectable()
export class ClinicalEscalationAccessGuard implements CanActivate {
  constructor(private readonly configuration: ConfigurationService) {}

  canActivate(context: ExecutionContext): boolean {
    const identity = context.switchToHttp().getRequest().user as HostIdentity | undefined;
    if (!identity) throw new ForbiddenException('Clinical escalation access denied.');
    if (this.configuration.nodeEnv === 'development' && this.configuration.devAuthEnabled) return true;
    if (identity.scopes.includes('clinical_escalation_review') || identity.scopes.includes('admin')) return true;
    throw new ForbiddenException('Clinical escalation review scope is required.');
  }
}
