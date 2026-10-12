import { Body, Controller, Delete, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { PushNotificationsService } from './push-notifications.service';

@Controller('mobile/push/devices')
@UseGuards(AuthGuard)
export class PushNotificationsController {
  constructor(private readonly push: PushNotificationsService) {}

  private mobile(req: { user?: HostIdentity }): HostIdentity {
    const identity = req.user;
    if (identity?.authType !== 'MOBILE' || !identity.mobileUserId || !identity.tenantId) {
      throw new UnauthorizedException('Mobile authentication is required.');
    }
    return identity;
  }

  @Post()
  async register(@Req() req: { user?: HostIdentity }, @Body() body: { token?: string }): Promise<{ registered: true }> {
    const identity = this.mobile(req);
    await this.push.register(identity.tenantId, identity.mobileUserId!, body?.token || '');
    return { registered: true };
  }

  @Delete()
  async unregister(@Req() req: { user?: HostIdentity }): Promise<{ unregistered: true }> {
    const identity = this.mobile(req);
    await this.push.unregisterAll(identity.tenantId, identity.mobileUserId!);
    return { unregistered: true };
  }
}
