import { Controller, Get, Patch, Param, Body, ParseIntPipe, UseGuards } from '@nestjs/common';
import { NavigationService, NavigationItemDto } from './navigation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('navigation')
export class NavigationController {
  constructor(private navigationService: NavigationService) {}

  /**
   * Get user's visible navigation menu based on their database role & permissions
   */
  @Get('user-menu')
  async getUserMenu(@CurrentUser() user: any) {
    const role = user?.role?.name || user?.role;
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    return this.navigationService.getNavigationTree(role, permissions);
  }

  /**
   * Get all navigation items configured in the database
   */
  @Get()
  async getAll() {
    return this.navigationService.findAll();
  }

  /**
   * Update label, path, icon, or sorting for a navigation item
   */
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<NavigationItemDto>,
  ) {
    return this.navigationService.update(id, body);
  }
}
