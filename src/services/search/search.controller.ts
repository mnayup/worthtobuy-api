import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) { }

  @Get()
  async search(@Query('q') q: string, @Query('search') searchFallback: string, @CurrentUser('role') role: string) {
    return this.searchService.search(q || searchFallback || '', role);
  }
}
