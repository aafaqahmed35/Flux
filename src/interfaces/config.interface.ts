export interface ServerConfig {
  env: string;
  port: number;
  appName: string;
  appVersion: string;
  tz: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  maxConnections: number;
  url: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  url: string;
}

export interface LoggerConfig {
  level: string;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  logger: LoggerConfig;
}
