import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { verifySync } from 'otplib';
import { PrismaService } from '../../config/prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(identifier: string, pass: string) {
    if (!identifier || !pass) {
      throw new BadRequestException('Username/Email dan password wajib diisi.');
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: cleanIdentifier, mode: 'insensitive' } },
          { email: { equals: cleanIdentifier, mode: 'insensitive' } },
        ],
      },
      include: { role: true },
    });

    if (!user || !user.is_active || user.deleted_at || !(await bcrypt.compare(pass, user.password_hash))) {
      throw new UnauthorizedException('Username/Email atau kata sandi salah.');
    }

    // If 2FA MFA is enabled for this user
    if (user.mfa_enabled && user.mfa_secret) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, isMfaPending: true },
        { expiresIn: '5m' },
      );
      return {
        mfaRequired: true,
        tempToken,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
        },
      };
    }

    const payload = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role.name,
      can_view_profit: user.role.can_view_profit,
    };

    const token = this.jwtService.sign(payload);
    return {
      mfaRequired: false,
      token,
      user: {
        ...payload,
        mfa_enabled: user.mfa_enabled,
      },
      permissions: user.role.permissions,
    };
  }

  async verifyMfa(tempToken: string, code: string) {
    if (!tempToken || !code) {
      throw new BadRequestException('Token sesi dan kode OTP diperlukan.');
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(tempToken);
    } catch {
      throw new UnauthorizedException('Sesi verifikasi MFA telah kedaluwarsa. Silakan login kembali.');
    }

    if (!payload?.isMfaPending || !payload?.sub) {
      throw new UnauthorizedException('Token MFA tidak valid.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });

    if (!user || !user.is_active || user.deleted_at || !user.mfa_secret) {
      throw new UnauthorizedException('Pengguna tidak valid atau MFA tidak aktif.');
    }

    const cleanCode = code.trim().toUpperCase();
    let isCodeValid = false;
    let usedRecoveryCode = false;

    // 1. Check TOTP 6-digit code
    const totpResult = verifySync({ token: cleanCode, secret: user.mfa_secret });
    if (totpResult.valid) {
      isCodeValid = true;
    } else if (user.mfa_recovery_codes && user.mfa_recovery_codes.includes(cleanCode)) {
      // 2. Check Backup Recovery Code
      isCodeValid = true;
      usedRecoveryCode = true;
    }

    if (!isCodeValid) {
      throw new UnauthorizedException('Kode OTP atau Recovery Code salah / kedaluwarsa.');
    }

    // If a backup code was used, consume it so it cannot be used again
    if (usedRecoveryCode) {
      const remainingCodes = user.mfa_recovery_codes.filter((rc) => rc !== cleanCode);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mfa_recovery_codes: remainingCodes },
      });
    }

    const authPayload = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role.name,
      can_view_profit: user.role.can_view_profit,
    };

    const token = this.jwtService.sign(authPayload);
    return {
      token,
      user: {
        ...authPayload,
        mfa_enabled: true,
      },
      permissions: user.role.permissions,
    };
  }

  async getMe(user_id: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: user_id },
      include: { role: true },
    });
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      avatar_url: user.avatar_url,
      role: user.role.name,
      can_view_profit: user.role.can_view_profit,
      permissions: user.role.permissions,
      mfa_enabled: user.mfa_enabled,
    };
  }
}
