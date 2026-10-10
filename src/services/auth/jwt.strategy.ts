import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../config/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'super-secret-jwt-key-worthtobuy-change-me-32chars',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.id },
      include: { role: true },
    });
    if (!user || !user.is_active || user.deleted_at) {
      throw new UnauthorizedException('Sesi tidak valid atau akun dinonaktifkan.');
    }
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
