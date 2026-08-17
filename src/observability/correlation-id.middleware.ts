import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const headerName = 'x-correlation-id';
    let correlationId = req.headers[headerName] as string | undefined;

    if (!correlationId) {
      correlationId = `vda-${crypto.randomUUID()}`;
    }

    (req as unknown as Record<string, unknown>)['correlationId'] =
      correlationId;
    res.setHeader(headerName, correlationId);
    next();
  }
}
