import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { HostIdentityContext } from './host-identity.context';
import { TenantContext } from '../tenants/tenant.context';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly hostIdentityContext: HostIdentityContext,
    private readonly tenantContext: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const headers = (request['headers'] || {}) as Record<
      string,
      string | undefined
    >;
    const authHeader = headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('Invalid Authorization header format');
    }

    const token = parts[1];
    try {
      const identity = await this.hostIdentityContext.validateToken(token);
      request['user'] = identity;
      this.tenantContext.setTenantId(identity.tenantId);
      return true;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      throw new UnauthorizedException(msg);
    }
  }
}
