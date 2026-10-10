import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../config/prisma/prisma.service';
import { setupUserMfa, enableUserMfa, disableUserMfa } from './helpers/users-mfa.helper';
import { sanitizeUserData, mapUserProfile, buildUserWhereClause } from './helpers/users-profile.helper';

const roleOrder = ['OWNER', 'ADMIN', 'SHOPPER', 'FINANCE'];

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getRoles() {
    const roles = await this.prisma.role.findMany({ select: { id: true, name: true, description: true } });
    roles.sort((a, b) => {
      const idxA = roleOrder.indexOf(a.name);
      const idxB = roleOrder.indexOf(b.name);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
    return roles;
  }

  async findAll(query: any) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const skip = (page - 1) * limit;
    const where = buildUserWhereClause(query);

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: { role: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = rows.map(sanitizeUserData);
    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user || user.deleted_at) throw new NotFoundException('Pengguna tidak ditemukan.');
    return sanitizeUserData(user);
  }

  async create(body: any) {
    await this.prisma.role.findUniqueOrThrow({ where: { id: Number(body.role_id) } });

    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('Nama wajib diisi.');

    const cleanUsername = String(body.username || '').trim().toLowerCase();
    if (!cleanUsername) throw new BadRequestException('Username wajib diisi.');

    const phone = String(body.phone || '').trim();
    if (!phone) throw new BadRequestException('No Whatsapp (Phone) wajib diisi.');

    const dupUsername = await this.prisma.user.findFirst({
      where: { username: { equals: cleanUsername, mode: 'insensitive' }, deleted_at: null },
    });
    if (dupUsername) throw new ConflictException(`Username '${cleanUsername}' sudah digunakan oleh pengguna lain.`);

    const cleanEmail = body.email ? String(body.email).trim().toLowerCase() : null;
    if (cleanEmail) {
      const dupEmail = await this.prisma.user.findFirst({
        where: { email: { equals: cleanEmail, mode: 'insensitive' }, deleted_at: null },
      });
      if (dupEmail) throw new ConflictException(`Email '${cleanEmail}' sudah digunakan oleh pengguna lain.`);
    }

    if (!body.password || body.password.length < 6) throw new BadRequestException('Password minimal 6 karakter.');

    const data = await this.prisma.user.create({
      data: {
        name,
        username: cleanUsername,
        email: cleanEmail,
        phone,
        password_hash: await bcrypt.hash(body.password, 10),
        role_id: Number(body.role_id),
        avatar_url: body.avatar_url ? String(body.avatar_url).trim() : null,
      },
      include: { role: true },
    });

    return sanitizeUserData(data);
  }

  async update(id: number, body: any) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { role: true },
    });

    const updateData: any = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestException('Nama tidak boleh kosong.');
      updateData.name = name;
    }

    if (body.username !== undefined) {
      const cleanUsername = String(body.username).trim().toLowerCase();
      if (!cleanUsername) throw new BadRequestException('Username tidak boleh kosong.');
      if (cleanUsername !== current.username) {
        const dup = await this.prisma.user.findFirst({
          where: { username: { equals: cleanUsername, mode: 'insensitive' }, id: { not: id }, deleted_at: null },
        });
        if (dup) throw new ConflictException(`Username '${cleanUsername}' sudah digunakan.`);
        updateData.username = cleanUsername;
      }
    }

    if (body.email !== undefined) {
      const cleanEmail = body.email ? String(body.email).trim().toLowerCase() : null;
      if (cleanEmail !== current.email) {
        if (cleanEmail) {
          const dup = await this.prisma.user.findFirst({
            where: { email: { equals: cleanEmail, mode: 'insensitive' }, id: { not: id }, deleted_at: null },
          });
          if (dup) throw new ConflictException(`Email '${cleanEmail}' sudah digunakan.`);
        }
        updateData.email = cleanEmail;
      }
    }

    if (body.phone !== undefined) updateData.phone = body.phone ? String(body.phone).trim() : null;
    if (body.avatar_url !== undefined) updateData.avatar_url = body.avatar_url ? String(body.avatar_url).trim() : null;

    if (body.role_id !== undefined && Number(body.role_id) !== current.role_id) {
      await this.prisma.role.findUniqueOrThrow({ where: { id: Number(body.role_id) } });
      if (current.role.name === 'OWNER') {
        const ownerCount = await this.prisma.user.count({ where: { role: { name: 'OWNER' }, is_active: true, deleted_at: null } });
        if (ownerCount <= 1) throw new BadRequestException('Tidak dapat mengubah role Owner terakhir.');
      }
      updateData.role_id = Number(body.role_id);
    }

    if (body.is_active !== undefined) {
      if (current.role.name === 'OWNER' && !body.is_active) {
        const ownerCount = await this.prisma.user.count({ where: { role: { name: 'OWNER' }, is_active: true, deleted_at: null } });
        if (ownerCount <= 1) throw new BadRequestException('Tidak dapat menonaktifkan Owner terakhir.');
      }
      updateData.is_active = Boolean(body.is_active);
    }

    if (body.password) {
      if (body.password.length < 6) throw new BadRequestException('Password minimal 6 karakter.');
      updateData.password_hash = await bcrypt.hash(body.password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
      include: { role: true },
    });

    return sanitizeUserData(updated);
  }

  async remove(id: number, currentUserId?: number) {
    if (id === currentUserId) throw new BadRequestException('Anda tidak dapat menghapus akun Anda sendiri.');
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id }, include: { role: true } });

    if (target.role.name === 'OWNER' && target.is_active) {
      const ownerCount = await this.prisma.user.count({ where: { role: { name: 'OWNER' }, is_active: true, deleted_at: null } });
      if (ownerCount <= 1) throw new BadRequestException('Owner terakhir tidak dapat dihapus.');
    }

    await this.prisma.user.update({
      where: { id },
      data: { is_active: false, deleted_at: new Date(), deleted_by_id: currentUserId },
    });
    return { success: true };
  }

  async getProfile(user_id: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: user_id },
      include: { role: true },
    });
    return mapUserProfile(user);
  }

  async updateProfile(user_id: number, body: { name?: string; username?: string; email?: string; phone?: string; avatar_url?: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: user_id } });
    const updateData: any = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestException('Nama tidak boleh kosong.');
      updateData.name = name;
    }

    if (body.username !== undefined) {
      const username = String(body.username).trim().toLowerCase();
      if (!username) throw new BadRequestException('Username tidak boleh kosong.');
      if (username !== user.username) {
        const dup = await this.prisma.user.findFirst({
          where: { username: { equals: username, mode: 'insensitive' }, id: { not: user_id }, deleted_at: null },
        });
        if (dup) throw new ConflictException(`Username '${username}' sudah digunakan.`);
        updateData.username = username;
      }
    }

    if (body.email !== undefined) {
      const email = body.email ? String(body.email).trim().toLowerCase() : null;
      if (email !== user.email) {
        if (email) {
          const dup = await this.prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' }, id: { not: user_id }, deleted_at: null },
          });
          if (dup) throw new ConflictException(`Email '${email}' sudah digunakan.`);
        }
        updateData.email = email;
      }
    }

    if (body.phone !== undefined) updateData.phone = body.phone ? String(body.phone).trim() : null;
    if (body.avatar_url !== undefined) updateData.avatar_url = body.avatar_url ? String(body.avatar_url).trim() : null;

    const updated = await this.prisma.user.update({
      where: { id: user_id },
      data: updateData,
      include: { role: true },
    });

    return mapUserProfile(updated);
  }

  async changePassword(user_id: number, currentPass: string, newPass: string) {
    if (!newPass || newPass.length < 6) throw new BadRequestException('Password baru minimal 6 karakter.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: user_id } });
    const isMatch = await bcrypt.compare(currentPass, user.password_hash);
    if (!isMatch) throw new BadRequestException('Password saat ini tidak cocok.');

    const password_hash = await bcrypt.hash(newPass, 10);
    await this.prisma.user.update({
      where: { id: user_id },
      data: { password_hash },
    });

    return { success: true, message: 'Password berhasil diperbarui.' };
  }

  async setupMfa(user_id: number) {
    return setupUserMfa(this.prisma, user_id);
  }

  async enableMfa(user_id: number, code: string, secret: string) {
    return enableUserMfa(this.prisma, user_id, code, secret);
  }

  async disableMfa(user_id: number, passwordOrCode: string) {
    return disableUserMfa(this.prisma, user_id, passwordOrCode);
  }
}
