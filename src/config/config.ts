import { parse } from 'toml';
import { readFileSync } from 'fs';
import { join } from 'path';

interface BotConfig {
  token: string;
  welcomeChannelId: string;
  ticketLogsChannelId: string;
  punishmentLogsChannelId: string;
  apiBaseUrl: string;
  apiKey: string;
  mongoUri: string;
  mongoDbName: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  testGuildId?: string;
  gemini?: {
    apiKey: string;
    apiEndpoint: string;
    generativeAIPrompt: string;
    muteThreshold: number;
    enabled: boolean;
  };
  antiRaid?: {
    enabled: boolean;
    joinThreshold: number;
    timeWindow: number;
    newAccountThreshold: number;
    suspiciousUsernamePatterns: string[];
  };
  antiNuke?: {
    enabled: boolean;
    massBanThreshold: number;
    massKickThreshold: number;
    massChannelDeleteThreshold: number;
    massRoleDeleteThreshold: number;
    massChannelCreateThreshold: number;
    massRoleCreateThreshold: number;
    timeWindow: number;
    permissionEscalationRoles: string[];
  };
  autoCooldown?: {
    enabled: boolean;
    spamThreshold: number;
    timeWindow: number;
    cooldownDuration: number;
    autoDisableDelay: number;
    whitelistedRoles: string[];
  };
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
  welcomeMessage: string;
  deeplApiKey?: string; // DeepL Free API key
}

class Config {
  private static instance: Config;
  private config: BotConfig;

  private constructor() {
    try {
      const configPath = join(process.cwd(), 'config.toml');
      const configFile = readFileSync(configPath, 'utf-8');
      this.config = parse(configFile) as BotConfig;
      // Debug: print loaded config and DeepL key
      console.debug('[Config] Loaded config:', this.config);
      console.debug('[Config] deeplApiKey:', this.config.deeplApiKey);
      // Validate required fields
      this.validateConfig();
    } catch (error) {
      console.error('Error loading config.toml:', error);
      throw new Error('Failed to load configuration. Please ensure config.toml exists and is valid.');
    }
  }

  private validateConfig() {
    const requiredFields: (keyof BotConfig)[] = [
      'token', 'welcomeChannelId', 'ticketLogsChannelId', 'punishmentLogsChannelId', 'apiBaseUrl', 'apiKey',
      'mongoUri', 'mongoDbName', 'redisHost', 'redisPort', 'redisPassword', 'welcomeMessage'
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

  public get ticketLogsChannelId(): string {
    return this.config.ticketLogsChannelId;
  }

  public get punishmentLogsChannelId(): string {
    return this.config.punishmentLogsChannelId;
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

  public get testGuildId(): string | undefined {
    return this.config.testGuildId;
  }

  public get geminiConfig() {
    return this.config.gemini || {
      apiKey: '',
      apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=%s',
      generativeAIPrompt: 'Analyze the text "%s" and rate its toxicity on a scale of 0 to 100, where 0 represents no toxicity and 100 represents extremely toxic content. Consider harmful language, such as racism, bad words, and harmful phrases, as toxic. However, be cautious with context. For example, if the text contains a question like "Is the n-word bannable?" it should receive a lower toxicity rating because the user is asking a question and not using the word itself. Additionally, if a text includes a single letter like "n", do not automatically assume it refers to a harmful word like "the n-word". Consider the possibility of mistyping; while it should add to the toxicity rating, it should not result in a high toxicity score by default.  Prioritize the severity of the language: hate speech, threats, and harassment should have the highest scores (e.g., 80-100), while general profanity (e.g., \'fuck\') should have a much lower impact (e.g., 10-30) unless used in an aggressive or targeted manner. Words like \'n-word\' (when referring to the term itself) should not be rated as highly toxic unless used with harmful intent. Be mindful of context—questions or discussions about language should have a lower score than direct attacks. Additionally, avoid assuming toxicity from single letters or potential mistypes. Ensure that the toxicity rating accurately reflects intent, distinguishing between casual language and genuinely harmful speech. Output only the rate number.',
      muteThreshold: 91.0,
      enabled: false
    };
  }

  public get welcomeImageConfig() {
    return this.config.welcomeImage || {};
  }

  public get welcomeMessage(): string {
    return this.config.welcomeMessage;
  }

  public get deeplApiKey(): string | undefined {
    return this.config.deeplApiKey;
  }

  public get antiRaidConfig() {
    return this.config.antiRaid || {
      enabled: true,
      joinThreshold: 10,
      timeWindow: 30 * 1000, // 30 seconds
      newAccountThreshold: 24 * 60 * 60 * 1000, // 24 hours
      suspiciousUsernamePatterns: [
        'discord.gg/',
        'free.*nitro',
        'nitro.*free',
        'steam.*gift',
        'gift.*steam',
        'robux.*free',
        'free.*robux',
        'minecraft.*free',
        'free.*minecraft',
        'hack.*client',
        'cheat.*client',
        'crack.*client',
        'premium.*free',
        'free.*premium',
        'vip.*free',
        'free.*vip',
        'admin.*free',
        'free.*admin',
        'mod.*free',
        'free.*mod'
      ]
    };
  }

  public get antiNukeConfig() {
    return this.config.antiNuke || {
      enabled: true,
      massBanThreshold: 3,
      massKickThreshold: 5,
      massChannelDeleteThreshold: 2,
      massRoleDeleteThreshold: 2,
      massChannelCreateThreshold: 5,
      massRoleCreateThreshold: 5,
      timeWindow: 10 * 1000, // 10 seconds
      permissionEscalationRoles: [
        'Administrator',
        'Owner',
        'Co-Owner',
        'Platform Admin',
        'System Admin'
      ]
    };
  }

  public get autoCooldownConfig() {
    return this.config.autoCooldown || {
      enabled: true,
      spamThreshold: 8,
      timeWindow: 10 * 1000, // 10 seconds
      cooldownDuration: 5 * 60 * 1000, // 5 minutes
      autoDisableDelay: 10 * 60 * 1000, // 10 minutes
      whitelistedRoles: [
        'Owner',
        'Co-Owner',
        'Platform Admin',
        'System Admin',
        'Admin',
        'Senior Admin',
        'Moderator',
        'Senior Mod',
        'Mod+',
        'Trial Mod'
      ]
    };
  }
}

// Export a type-safe config object with all the getters
export const config = {
  get token() { return Config.getInstance().token; },
  get welcomeChannelId() { return Config.getInstance().welcomeChannelId; },
  get ticketLogsChannelId() { return Config.getInstance().ticketLogsChannelId; },
  get punishmentLogsChannelId() { return Config.getInstance().punishmentLogsChannelId; },
  get apiBaseUrl() { return Config.getInstance().apiBaseUrl; },
  get apiKey() { return Config.getInstance().apiKey; },
  get mongoUri() { return Config.getInstance().mongoUri; },
  get mongoDbName() { return Config.getInstance().mongoDbName; },
  get redisHost() { return Config.getInstance().redisHost; },
  get redisPort() { return Config.getInstance().redisPort; },
  get redisPassword() { return Config.getInstance().redisPassword; },
  get testGuildId() { return Config.getInstance().testGuildId; },
  get geminiConfig() { return Config.getInstance().geminiConfig; },
  get antiRaidConfig() { return Config.getInstance().antiRaidConfig; },
  get antiNukeConfig() { return Config.getInstance().antiNukeConfig; },
  get autoCooldownConfig() { return Config.getInstance().autoCooldownConfig; },
  get welcomeImageConfig() { return Config.getInstance().welcomeImageConfig; },
  get welcomeMessage() { return Config.getInstance().welcomeMessage; },
  get deeplApiKey() { return Config.getInstance().deeplApiKey; }
} as const; 