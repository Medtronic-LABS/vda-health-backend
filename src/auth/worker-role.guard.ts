import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { HostIdentity } from './host-identity.context';

/** Prevents mobile identities from reaching privileged worker/admin routes. */
@Injectable()
export class WorkerRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: HostIdentity }>();
    const identity = request.user;
    if (
      !identity ||
      identity.authType === 'MOBILE' ||
      !identity.workerRole ||
      !['ASHA', 'ANM', 'CHO'].includes(identity.workerRole)
    ) {
      throw new ForbiddenException('WORKER_ROLE_REQUIRED');
    }
    return true;
  }
}
