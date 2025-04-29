import { parse } from 'toml';
import { readFileSync } from 'fs';
import { join } from 'path';

interface BotConfig {
  token: string;
  welcomeChannelId: string;
  apiBaseUrl: string;
  apiKey: string;
  mongoUri: string;
  mongoDbName: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  welcomeImage?: {
    backgroundPath?: string;
    guildName?: string;
    level?: number;
    usernameColor?: string;
    memberCountColor?: string;
    customFont?: string;
    fontSize?: {
      welcome?: number;
      username?: number;
      memberCount?: number;
    };
  };
}

class Config {
  private static instance: Config;
  private config: BotConfig;

  private constructor() {
    try {
      const configPath = join(process.cwd(), 'config.toml');
      const configFile = readFileSync(configPath, 'utf-8');
      this.config = parse(configFile) as BotConfig;

      // Validate required fields
      this.validateConfig();
    } catch (error) {
      console.error('Error loading config.toml:', error);
      throw new Error('Failed to load configuration. Please ensure config.toml exists and is valid.');
    }
  }

  private validateConfig() {
    const requiredFields: (keyof BotConfig)[] = [
      'token', 'welcomeChannelId', 'apiBaseUrl', 'apiKey',
      'mongoUri', 'mongoDbName', 'redisHost', 'redisPort', 'redisPassword'
    ];

    for (const field of requiredFields) {
      if (!this.config[field]) {
        throw new Error(`Missing required config field: ${field}`);
      }
    }
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  public get token(): string {
    return this.config.token;
  }

  public get welcomeChannelId(): string {
    return this.config.welcomeChannelId;
  }

  public get apiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  public get apiKey(): string {
    return this.config.apiKey;
  }

  public get mongoUri(): string {
    return this.config.mongoUri;
  }

  public get mongoDbName(): string {
    return this.config.mongoDbName;
  }

  public get redisHost(): string {
    return this.config.redisHost;
  }

  public get redisPort(): number {
    return this.config.redisPort;
  }

  public get redisPassword(): string {
    return this.config.redisPassword;
  }

  public get welcomeImageConfig() {
    return this.config.welcomeImage || {};
  }
}

// Export a type-safe config object with all the getters
export const config = {
  get token() { return Config.getInstance().token; },
  get welcomeChannelId() { return Config.getInstance().welcomeChannelId; },
  get apiBaseUrl() { return Config.getInstance().apiBaseUrl; },
  get apiKey() { return Config.getInstance().apiKey; },
  get mongoUri() { return Config.getInstance().mongoUri; },
  get mongoDbName() { return Config.getInstance().mongoDbName; },
  get redisHost() { return Config.getInstance().redisHost; },
  get redisPort() { return Config.getInstance().redisPort; },
  get redisPassword() { return Config.getInstance().redisPassword; },
  get welcomeImageConfig() { return Config.getInstance().welcomeImageConfig; }
} as const; 