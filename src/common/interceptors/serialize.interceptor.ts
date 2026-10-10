import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export function serializeData<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && val.constructor?.name === 'Decimal') {
      return Number(val.toString());
    }
    if (typeof val === 'bigint') {
      return Number(val);
    }
    return val;
  }));
}

@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map(data => serializeData(data)));
  }
}
