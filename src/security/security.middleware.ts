import { Request, Response, NextFunction } from 'express';

export const securityHeadersMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Allow inline styles/scripts on /docs for Swagger UI compatibility
  if (!req.path.startsWith('/docs')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none';",
    );
  }

  next();
};
