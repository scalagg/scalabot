import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { sentryService } from './SentryService';
import { serverUtils, ServerType } from '../utils/ServerUtils';
import { mongoService } from './MongoService';
import { MongoClient } from 'mongodb';
import { config } from '../config/config';

// UUID to Username cache
const uuidCache = new Map<string, string>();

// UUID resolution function - using Mojang API
async function resolveUUIDToUsername(uuid: string): Promise<string> {
    console.log(`[UUID Resolution] Attempting to resolve UUID: ${uuid}`);
    
    // Check cache first
    if (uuidCache.has(uuid)) {
        const cached = uuidCache.get(uuid)!;
        console.log(`[UUID Resolution] Found in cache: ${uuid} -> ${cached}`);
        return cached;
    }

    try {
        // Use Mojang API to get username from UUID
        // Format: https://sessionserver.mojang.com/session/minecraft/profile/{uuid}
        const mojangUrl = `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`;
        console.log(`[UUID Resolution] Trying Mojang API: ${mojangUrl}`);
        
        const response = await fetch(mojangUrl);
        console.log(`[UUID Resolution] Mojang API response status: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`[UUID Resolution] Mojang API response data:`, data);
            
            if (data.name) {
                uuidCache.set(uuid, data.name);
                console.log(`[UUID Resolution] Successfully resolved via Mojang API: ${uuid} -> ${data.name}`);
                return data.name;
            }
        } else if (response.status === 204) {
            // 204 means no content - player doesn't exist or UUID is invalid
            console.log(`[UUID Resolution] Mojang API returned 204 - no player found for UUID: ${uuid}`);
        } else {
            console.log(`[UUID Resolution] Mojang API error: ${response.status} ${response.statusText}`);
        }

    } catch (error) {
        console.error(`[UUID Resolution] Error resolving UUID ${uuid} via Mojang API:`, error);
    }

    // If we can't resolve, don't cache the failure - let it try again
    console.log(`[UUID Resolution] Failed to resolve UUID: ${uuid}, will retry later`);
    return `Unknown_${uuid.substring(0, 8)}`;
}

export enum LeaderboardCollectionType {
    FACTIONS = 'FACTIONS',
    PLAYER = 'PLAYER'
}

export enum LeaderboardType {
    KITMAP = 'KitMap',
    INFERNO = 'Inferno'
}

// Map enum values to actual database names
const LEADERBOARD_DATABASE_MAP: Record<LeaderboardType, string> = {
    [LeaderboardType.KITMAP]: 'KitMap',
    [LeaderboardType.INFERNO]: 'Inferno'
};

export interface LeaderboardEntry<T> {
    key: string;
    value: T;
    displayName: string;
}

export abstract class Leaderboard<T> {
    public key: string;
    public name: string;
    public type: LeaderboardType;
    protected collectionType: LeaderboardCollectionType;
    private defaultValue: T;
    public entries: LeaderboardEntry<T>[] = [];

    constructor(
        key: string,
        name: string,
        type: LeaderboardType,
        collectionType: LeaderboardCollectionType,
        defaultValue: T
    ) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.collectionType = collectionType;
        this.defaultValue = defaultValue;
    }

    abstract format(index: number, entry: LeaderboardEntry<T>): string;
    abstract loadAll(): Promise<LeaderboardEntry<T>[]>;

    async refresh(): Promise<void> {
        try {
            const entries = await this.loadAll();

            // Fill up to 10 entries with default values if needed
            if (entries.length < 10) {
                const remaining = 10 - entries.length;
                for (let i = 0; i < remaining; i++) {
                    entries.push({
                        key: '???',
                        value: this.defaultValue,
                        displayName: '???'
                    });
                }
            }

            this.entries = entries;
        } catch (error) {
            console.error(`[Leaderboard] Error refreshing ${this.name}:`, error);
            sentryService.captureException(error as Error, {
                context: 'leaderboard_refresh',
                leaderboard_name: this.name,
                leaderboard_type: this.type
            });
        }
    }
}

export class IntLeaderboard extends Leaderboard<number> {
    private formatter: (value: number) => string;

    constructor(
        key: string,
        name: string,
        type: LeaderboardType,
        collectionType: LeaderboardCollectionType,
        defaultValue: number = 0,
        formatter: (value: number) => string = (value) => value.toString()
    ) {
        super(key, name, type, collectionType, defaultValue);
        this.formatter = formatter;
    }

    format(index: number, entry: LeaderboardEntry<number>): string {
        return `**#${index}**. ${entry.displayName}: ${this.formatter(entry.value)}`;
    }

    async loadAll(): Promise<LeaderboardEntry<number>[]> {
        try {
            const databaseName = LEADERBOARD_DATABASE_MAP[this.type];
            
            // Use native MongoDB driver to access different databases
            const client = new MongoClient(config.mongoUri);
            await client.connect();
            
            const db = client.db(databaseName);
            const collection = this.collectionType === LeaderboardCollectionType.FACTIONS 
                ? db.collection('factions')
                : db.collection('statistics');

            const pipeline = [
                {
                    $match: {
                        [this.key]: { $exists: true, $gt: 0 }
                    }
                },
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        [this.key]: 1
                    }
                },
                {
                    $sort: { [this.key]: -1 }
                },
                {
                    $limit: 10
                }
            ];

            const results = await collection.aggregate(pipeline).toArray();
            
            console.log(`[Leaderboard] Found ${results.length} results for ${this.name} in ${databaseName}.${this.collectionType === LeaderboardCollectionType.FACTIONS ? 'factions' : 'statistics'}`);
            if (results.length > 0) {
                console.log(`[Leaderboard] Sample result:`, results[0]);
            }

            // Close the client connection
            await client.close();

            // Resolve UUIDs to usernames for player statistics
            console.log(`[Leaderboard] Resolving ${results.length} entries for ${this.name}`);
            const resolvedResults = await Promise.all(
                results.map(async (doc, index) => {
                    let displayName: string;
                    
                    if (this.collectionType === LeaderboardCollectionType.FACTIONS) {
                        displayName = doc.name || 'Unknown Faction';
                        console.log(`[Leaderboard] Faction entry ${index + 1}: ${displayName}`);
                    } else {
                        // Resolve UUID to username for player statistics
                        console.log(`[Leaderboard] Resolving player UUID: ${doc._id}`);
                        displayName = await resolveUUIDToUsername(doc._id) || 'Unknown Player';
                        console.log(`[Leaderboard] Player entry ${index + 1}: ${doc._id} -> ${displayName}`);
                    }

                    return {
                        key: doc._id,
                        value: doc[this.key] || 0,
                        displayName
                    };
                })
            );

            return resolvedResults;
        } catch (error) {
            console.error(`[IntLeaderboard] Error loading ${this.name}:`, error);
            sentryService.captureException(error as Error, {
                context: 'int_leaderboard_load',
                leaderboard_name: this.name,
                collection_type: this.collectionType
            });
            return [];
        }
    }
}

export class LeaderboardService {
    private static instance: LeaderboardService;
    private leaderboards: Map<LeaderboardType, Leaderboard<any>[]> = new Map();
    private refreshInterval: NodeJS.Timeout | null = null;
    private lastMessageIds: Map<LeaderboardType, string> = new Map();
    private client: any = null;

    private constructor() {
        this.initializeLeaderboards();
    }

    public static getInstance(): LeaderboardService {
        if (!LeaderboardService.instance) {
            LeaderboardService.instance = new LeaderboardService();
        }
        return LeaderboardService.instance;
    }

    private initializeLeaderboards(): void {
        // KitMap Leaderboards
        const kitMapLeaderboards: Leaderboard<any>[] = [
            new IntLeaderboard('kills', 'Kills', LeaderboardType.KITMAP, LeaderboardCollectionType.PLAYER),
            new IntLeaderboard('playTime', 'Playtime', LeaderboardType.KITMAP, LeaderboardCollectionType.PLAYER, 0, 
                (value) => this.formatPlaytime(value * 1000)),
            new IntLeaderboard('points', 'Faction Points', LeaderboardType.KITMAP, LeaderboardCollectionType.FACTIONS)
        ];

        // Inferno Leaderboards
        const infernoLeaderboards: Leaderboard<any>[] = [
            new IntLeaderboard('kills', 'Kills', LeaderboardType.INFERNO, LeaderboardCollectionType.PLAYER),
            new IntLeaderboard('playTime', 'Playtime', LeaderboardType.INFERNO, LeaderboardCollectionType.PLAYER, 0,
                (value) => this.formatPlaytime(value * 1000)),
            new IntLeaderboard('points', 'Faction Points', LeaderboardType.INFERNO, LeaderboardCollectionType.FACTIONS)
        ];

        this.leaderboards.set(LeaderboardType.KITMAP, kitMapLeaderboards);
        this.leaderboards.set(LeaderboardType.INFERNO, infernoLeaderboards);
    }

    public setClient(client: any): void {
        this.client = client;
    }

    public async startRefreshLoop(): Promise<void> {
        if (this.refreshInterval) {
            return;
        }

        // Initial refresh
        await this.refreshAllLeaderboards();
        await this.updateAllLeaderboardMessages();

        // Refresh every 60 seconds
        this.refreshInterval = setInterval(async () => {
            await this.refreshAllLeaderboards();
            await this.updateAllLeaderboardMessages();
        }, 60000);

        console.log('[LeaderboardService] Started refresh loop');
    }

    public async sendInitialMessages(): Promise<void> {
        console.log('[LeaderboardService] Sending initial leaderboard messages...');
        await this.updateAllLeaderboardMessages();
    }

    public async stopRefreshLoop(): Promise<void> {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            console.log('[LeaderboardService] Stopped refresh loop');
        }
    }

    public async refreshAllLeaderboards(): Promise<void> {
        const promises: Promise<void>[] = [];
        
        for (const [type, leaderboards] of this.leaderboards) {
            for (const leaderboard of leaderboards) {
                promises.push(leaderboard.refresh());
            }
        }

        await Promise.all(promises);
    }

    public async updateAllLeaderboardMessages(): Promise<void> {
        if (!this.client) {
            console.log('[LeaderboardService] No client set, skipping message updates');
            return;
        }

        const config = await import('../config/config');
        
        for (const guild of this.client.guilds.cache.values()) {
            for (const type of this.getAllTypes()) {
                try {
                    const channelId = config.config.leaderboardChannels[type];
                    if (!channelId) {
                        console.log(`[LeaderboardService] No channel configured for ${type}`);
                        continue;
                    }

                    const channel = guild.channels.cache.get(channelId);
                    if (!channel || !channel.isTextBased()) {
                        console.log(`[LeaderboardService] Channel ${channelId} not found or not text-based for ${type}`);
                        continue;
                    }

                    // Delete all previous bot messages in the channel
                    try {
                        const messages = await channel.messages.fetch({ limit: 10 });
                        const botMessages = messages.filter((msg: any) => msg.author.id === this.client.user.id);
                        
                        if (botMessages.size > 0) {
                            await channel.bulkDelete(botMessages);
                            console.log(`[LeaderboardService] Deleted ${botMessages.size} previous bot messages for ${type}`);
                        }
                    } catch (error) {
                        console.log(`[LeaderboardService] Could not delete previous messages for ${type}:`, error);
                    }

                    // Create new message
                    const embed = this.createLeaderboardEmbed(type);
                    const newMessage = await channel.send({ embeds: [embed] });
                    this.lastMessageIds.set(type, newMessage.id);
                    console.log(`[LeaderboardService] Created new leaderboard message for ${type}`);

                } catch (error) {
                    console.error(`[LeaderboardService] Error updating leaderboard for ${type}:`, error);
                    sentryService.captureException(error as Error, {
                        context: 'leaderboard_message_update',
                        leaderboard_type: type,
                        guild_id: guild.id
                    });
                }
            }
        }
    }

    public getLeaderboards(type: LeaderboardType): Leaderboard<any>[] {
        return this.leaderboards.get(type) || [];
    }

    public getAllTypes(): LeaderboardType[] {
        return Array.from(this.leaderboards.keys());
    }

    public updateUuidCache(uuid: string, username: string): void {
        uuidCache.set(uuid, username);
        console.log(`[LeaderboardService] Updated UUID cache: ${uuid} -> ${username}`);
    }

    public createLeaderboardEmbed(type: LeaderboardType): EmbedBuilder {
        const leaderboards = this.getLeaderboards(type);
        
        // Force HolyPvP branding for leaderboards
        serverUtils.setServerType(ServerType.HOLYPVP);
        const theme = serverUtils.getTheme();
        const info = serverUtils.getInfo();

        const embed = new EmbedBuilder()
            .setTitle(`${type} Leaderboards`)
            .setColor(theme.primary)
            .setTimestamp();

        for (const leaderboard of leaderboards) {
            let fieldValue = '\n';
            
            leaderboard.entries.forEach((entry, index) => {
                fieldValue += leaderboard.format(index + 1, entry) + '\n';
            });

            embed.addFields({
                name: `**${leaderboard.name}**`,
                value: fieldValue,
                inline: true
            });
        }

        embed.setFooter({ 
            text: `Last updated • ${info.name}`, 
            iconURL: info.logo 
        });

        return embed;
    }

    private formatPlaytime(millis: number): string {
        if (millis <= 1000) {
            return '0s';
        }

        const secs = Math.floor(millis / 1000);
        if (secs < 60) {
            return `${secs}s`;
        }

        const days = Math.floor(secs / 86400);
        const hours = Math.floor((secs % 86400) / 3600);
        const minutes = Math.floor((secs % 3600) / 60);

        let result = '';
        if (days > 0) result += `${days}d `;
        if (hours > 0) result += `${hours}h `;
        if (minutes > 0) result += `${minutes}m`;

        return result.trim() || '0s';
    }
}

export const leaderboardService = LeaderboardService.getInstance();
