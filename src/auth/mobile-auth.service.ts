import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { ConfigurationService } from '../configuration/configuration.service';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { MobileLoginDto } from './dto/mobile-login.dto';
import { MobileSignupDto } from './dto/mobile-signup.dto';
import { UpdateMobileProfileDto } from './dto/update-mobile-profile.dto';
import { MobileAuthTokenService } from './mobile-auth-token.service';

@Injectable()
export class MobileAuthService {
  private static readonly MAX_FAILED_LOGINS = 5;
  private static readonly LOCKOUT_MS = 15 * 60 * 1000;
  constructor(@InjectRepository(MobileUser) private readonly users: Repository<MobileUser>, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, private readonly tokens: MobileAuthTokenService, private readonly config: ConfigurationService) {}

  async signup(dto: MobileSignupDto) {
    const phone = this.normalizePhone(dto.phone);
    if (await this.users.exists({ where: { phone } })) throw new ConflictException('An account already exists for this mobile number.');
    const tenantId = this.config.mobileAuthTenantId;
    await this.ensureTenant(tenantId);
    const user = this.users.create({
      tenantId, fullName: this.cleanText(dto.fullName), phone, pinHash: await hash(dto.pin, 12), age: dto.age,
      gender: dto.gender, state: this.cleanText(dto.state), district: this.cleanText(dto.district),
      preferredLanguage: dto.preferredLanguage || dto.language || 'hi', abhaNumber: this.cleanOptional(dto.abhaNumber),
      isActive: true, failedLoginAttempts: 0, lockedUntil: null,
    });
    try { return this.authResponse(await this.users.save(user)); }
    catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('An account already exists for this mobile number.');
      throw error;
    }
  }

  async login(dto: MobileLoginDto) {
    const phone = this.normalizePhone(dto.phone);
    const user = await this.users.createQueryBuilder('user')
      .addSelect(['user.pinHash', 'user.failedLoginAttempts', 'user.lockedUntil', 'user.abhaNumber'])
      .where('user.phone = :phone', { phone }).andWhere('user.isActive = true').getOne();
    if (!user) throw new UnauthorizedException('Invalid mobile number or PIN.');
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new HttpException('Too many failed attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    if (!(await compare(dto.pin, user.pinHash))) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= MobileAuthService.MAX_FAILED_LOGINS) {
        user.lockedUntil = new Date(Date.now() + MobileAuthService.LOCKOUT_MS);
        user.failedLoginAttempts = 0;
      }
      await this.users.save(user);
      throw new UnauthorizedException('Invalid mobile number or PIN.');
    }
    if (user.failedLoginAttempts || user.lockedUntil) {
      user.failedLoginAttempts = 0; user.lockedUntil = null; await this.users.save(user);
    }
    return this.authResponse(user);
  }

  async getProfile(userId: string, tenantId: string) { return this.safeProfile(await this.findProfile(userId, tenantId)); }
  async updateProfile(userId: string, tenantId: string, dto: UpdateMobileProfileDto) {
    const user = await this.findProfile(userId, tenantId);
    if (dto.fullName !== undefined) user.fullName = this.cleanText(dto.fullName);
    if (dto.age !== undefined) user.age = dto.age;
    if (dto.gender !== undefined) user.gender = dto.gender;
    if (dto.state !== undefined) user.state = this.cleanText(dto.state);
    if (dto.district !== undefined) user.district = this.cleanText(dto.district);
    const language = dto.preferredLanguage || dto.language;
    if (language !== undefined) user.preferredLanguage = language;
    if (dto.abhaNumber !== undefined) user.abhaNumber = this.cleanOptional(dto.abhaNumber);
    return this.safeProfile(await this.users.save(user));
  }

  private async findProfile(userId: string, tenantId: string): Promise<MobileUser> {
    const user = await this.users.createQueryBuilder('user').addSelect('user.abhaNumber')
      .where('user.id = :userId', { userId }).andWhere('user.tenantId = :tenantId', { tenantId })
      .andWhere('user.isActive = true').getOne();
    if (!user) throw new UnauthorizedException('Mobile user is inactive or unavailable.');
    return user;
  }
  private authResponse(user: MobileUser) {
    const issued = this.tokens.issue(user);
    return { token: issued.token, tokenType: 'Bearer', expiresAt: issued.expiresAt, expiresInSeconds: issued.expiresInSeconds, user: this.safeProfile(user) };
  }
  private safeProfile(user: MobileUser) {
    return { id: user.id, fullName: user.fullName, phone: user.phone, age: user.age, gender: user.gender, state: user.state, district: user.district, language: user.preferredLanguage, preferredLanguage: user.preferredLanguage, ...(user.abhaNumber ? { abhaNumber: user.abhaNumber } : {}), createdAt: user.createdAt, updatedAt: user.updatedAt };
  }
  private normalizePhone(value: string): string {
    let digits = value.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (!/^[6-9]\d{9}$/.test(digits)) throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');
    return digits;
  }
  private cleanText(value: string): string { return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }
  private cleanOptional(value?: string | null): string | null { return value ? this.cleanText(value) || null : null; }
  private async ensureTenant(tenantId: string): Promise<void> {
    if (await this.tenants.exists({ where: { id: tenantId } })) return;
    await this.tenants.save(this.tenants.create({ id: tenantId, name: `VDA Mobile Pilot ${tenantId.slice(0, 8)}`, domain: `mobile-${tenantId.slice(0, 8)}.vda.local`, status: 'ACTIVE' }));
  }
}
