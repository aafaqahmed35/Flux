import { env } from './env.js';
import { ServerConfig } from '../interfaces/config.interface.js';

export const serverConfig: ServerConfig = {
  env: env.NODE_ENV,
  port: env.PORT,
  appName: env.APP_NAME,
  appVersion: env.APP_VERSION,
  tz: env.TZ,
};
