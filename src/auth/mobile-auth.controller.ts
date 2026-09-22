import { Body, Controller, Get, Post, Put, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { TenantRateLimiterGuard } from '../common/guards/tenant-rate-limiter.guard';
import { AuthGuard } from './auth.guard';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { MobileSignupDto } from './dto/mobile-signup.dto';
import { UpdateMobileProfileDto } from './dto/update-mobile-profile.dto';
import { HostIdentity } from './host-identity.context';
import { MobileAuthService } from './mobile-auth.service';

@Controller('auth')
export class MobileAuthController {
  constructor(private readonly auth: MobileAuthService) {}
  @Post('signup') @UseGuards(TenantRateLimiterGuard) signup(@Body() dto: MobileSignupDto) { return this.auth.signup(dto); }
  @Post('login') @UseGuards(TenantRateLimiterGuard) login(@Body() dto: MobileLoginDto) { return this.auth.login(dto); }
  @Get('profile') @UseGuards(AuthGuard) profile(@Req() request: Record<string, unknown>) {
    const identity = this.mobileIdentity(request); return this.auth.getProfile(identity.mobileUserId!, identity.tenantId);
  }
  @Put('profile') @UseGuards(AuthGuard) updateProfile(@Req() request: Record<string, unknown>, @Body() dto: UpdateMobileProfileDto) {
    const identity = this.mobileIdentity(request); return this.auth.updateProfile(identity.mobileUserId!, identity.tenantId, dto);
  }
  private mobileIdentity(request: Record<string, unknown>): HostIdentity {
    const identity = request['user'] as HostIdentity;
    if (identity.authType !== 'MOBILE' || !identity.mobileUserId) throw new UnauthorizedException('Mobile authentication is required.');
    return identity;
  }
}
