import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { HostIdentity } from '../auth/host-identity.context';

@Injectable()
export class WorkerVerificationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: HostIdentity }>();
    const identity = request.user;
    if (!identity || identity.authType === 'MOBILE' || !identity.workerRole) {
      throw new ForbiddenException('PRESCRIPTION_VERIFIER_ROLE_REQUIRED');
    }
    if (!['ASHA', 'ANM', 'CHO'].includes(identity.workerRole)) {
      throw new ForbiddenException('PRESCRIPTION_VERIFIER_ROLE_REQUIRED');
    }
    return true;
  }
}
