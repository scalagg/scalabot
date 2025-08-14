import { GuildMember } from 'discord.js';
import { sentryService } from './SentryService';
import { syncService } from './SyncService';
import { serverUtils } from '../utils/ServerUtils';
import { config } from '../config/config';

interface PacketData {
    discordId?: string;
    rank?: string;
    grant?: string;
    [key: string]: any;
}

interface GrantData {
    rank: string;
    [key: string]: any;
}

export class PacketListenerService {
    private static instance: PacketListenerService;
    private redis: any;
    private subscriber: any;
    private isListening = false;

    private constructor() {}

    public static getInstance(): PacketListenerService {
        if (!PacketListenerService.instance) {
            PacketListenerService.instance = new PacketListenerService();
        }
        return PacketListenerService.instance;
    }

    public setRedis(redis: any): void {
        this.redis = redis;
    }

    public async startListening(): Promise<void> {
        if (this.isListening || !this.redis) {
            return;
        }

        try {
            console.log('[PacketListener] Starting Redis packet listener...');
            
            // Create a separate subscriber connection for pub/sub
            this.subscriber = this.redis.duplicate();
            
            // Set up event handlers for the subscriber
            this.subscriber.on('message', (channel: string, message: string) => {
                console.log(`[PacketListener] Received message on channel ${channel}:`, message);
                this.handlePacket(message);
            });

            this.subscriber.on('error', (error: any) => {
                console.error('[PacketListener] Subscriber error:', error);
                sentryService.captureException(error as Error, {
                    context: 'packet_listener_subscriber_error',
                });
            });

            this.subscriber.on('connect', () => {
                console.log('[PacketListener] Subscriber connected to Redis');
            });

            // Subscribe to the single circuit channel (matches your Kotlin Circuit system)
            const circuitChannel = config.circuitChannel;
            await this.subscriber.subscribe(circuitChannel);

            this.isListening = true;
            console.log(`[PacketListener] Redis packet listener started successfully on channel: ${circuitChannel}`);

        } catch (error) {
            console.error('[PacketListener] Error starting packet listener:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_listener_start',
            });
        }
    }

    public async stopListening(): Promise<void> {
        if (!this.isListening) {
            return;
        }

        try {
            console.log('[PacketListener] Stopping Redis packet listener...');
            this.isListening = false;
            console.log('[PacketListener] Redis packet listener stopped');
        } catch (error) {
            console.error('[PacketListener] Error stopping packet listener:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_listener_stop',
            });
        }
    }

    private async handlePacket(message: string): Promise<void> {
        try {
            // Parse the packet payload (matches your Kotlin Circuit system)
            const payload = JSON.parse(message);
            const packetId = payload._id;
            const packetData = payload.data;

            // console.log(`[PacketListener] Received packet: ${packetId}`);

            // Handle different packet types based on your Kotlin ProfileUpdateAction
            switch (packetId) {
                case 'PROFILE_GRANT_ADD':
                    await this.handleGrantAdd(packetData);
                    break;
                case 'PROFILE_GRANT_REMOVE':
                    await this.handleGrantRemove(packetData);
                    break;
                case 'DISCORD_SYNC_COMPLETED':
                    await this.handleDiscordSyncCompleted(packetData);
                    break;
                case 'API_UUID_CACHE_UPDATE':
                    await this.handleUuidCacheUpdate(packetData);
                    break;
                default:
                    // console.debug(`[PacketListener] Ignoring unknown packet: ${packetId}`);
            }

        } catch (error) {
            console.error('[PacketListener] Error handling packet:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_handler',
                message: message
            });
        }
    }

    private async handleGrantAdd(data: any): Promise<void> {
        try {
            if (!data.discordId) {
                console.warn('[PacketListener] Grant add packet missing discordId');
                return;
            }

            let grantData: GrantData;
            if (data.grant) {
                grantData = JSON.parse(data.grant);
            } else {
                console.warn('[PacketListener] Grant add packet missing grant data');
                return;
            }

            // Only handle rank grants (matches your Kotlin logic)
            if (grantData.rank) {
                await this.addRoleToUser(data.discordId, grantData.rank);
            }

        } catch (error) {
            console.error('[PacketListener] Error handling grant add packet:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_grant_add',
                data: data
            });
        }
    }

    private async handleGrantRemove(data: any): Promise<void> {
        try {
            if (!data.discordId || !data.rank) {
                console.warn('[PacketListener] Grant remove packet missing required data');
                return;
            }

            await this.removeRoleFromUser(data.discordId, data.rank);

        } catch (error) {
            console.error('[PacketListener] Error handling grant remove packet:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_grant_remove',
                data: data
            });
        }
    }

    private async handleDiscordSyncCompleted(data: any): Promise<void> {
        try {
            console.log('[PacketListener] Discord sync completed:', data);
            
            // This packet is sent when a user successfully syncs their Discord account
            // The data contains: player, syncedAt, discordId, discriminator
            // We can use this to log the sync or perform any additional actions
            
            if (data.discordId && data.player) {
                console.log(`[PacketListener] User ${data.discordId} synced account for player ${data.player}`);
                
                // You could add additional logic here, such as:
                // - Logging the sync to a database
                // - Sending a welcome message
                // - Adding a default role
                // - Notifying staff
            }

        } catch (error) {
            console.error('[PacketListener] Error handling discord sync completed packet:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_discord_sync_completed',
                data: data
            });
        }
    }

    private async addRoleToUser(discordId: string, rankId: string): Promise<void> {
        try {
            // Get the rank information from your API
            const rankInfo = await this.getRankInfo(rankId);
            if (!rankInfo || !rankInfo.discordId) {
                console.warn(`[PacketListener] Rank ${rankId} has no Discord role ID`);
                return;
            }

            // Add role to user in all guilds
            const guilds = await this.getGuilds();
            for (const guild of guilds) {
                try {
                    const member = await guild.members.fetch(discordId);
                    const role = guild.roles.cache.get(rankInfo.discordId);
                    
                    if (role && !member.roles.cache.has(role.id)) {
                        await member.roles.add(role, 'Rank grant via packet');
                        console.log(`[PacketListener] Added role ${role.name} to user ${member.user.tag} in ${guild.name}`);
                    }
                } catch (memberError) {
                    // User might not be in this guild, which is fine
                    console.debug(`[PacketListener] User ${discordId} not found in guild ${guild.name}`);
                }
            }

        } catch (error) {
            console.error('[PacketListener] Error adding role to user:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_add_role',
                discord_id: discordId,
                rank_id: rankId
            });
        }
    }

    private async removeRoleFromUser(discordId: string, rankId: string): Promise<void> {
        try {
            // Get the rank information from your API
            const rankInfo = await this.getRankInfo(rankId);
            if (!rankInfo || !rankInfo.discordId) {
                console.warn(`[PacketListener] Rank ${rankId} has no Discord role ID`);
                return;
            }

            // Remove role from user in all guilds
            const guilds = await this.getGuilds();
            for (const guild of guilds) {
                try {
                    const member = await guild.members.fetch(discordId);
                    const role = guild.roles.cache.get(rankInfo.discordId);
                    
                    if (role && member.roles.cache.has(role.id)) {
                        await member.roles.remove(role, 'Rank removal via packet');
                        console.log(`[PacketListener] Removed role ${role.name} from user ${member.user.tag} in ${guild.name}`);
                    }
                } catch (memberError) {
                    // User might not be in this guild, which is fine
                    console.debug(`[PacketListener] User ${discordId} not found in guild ${guild.name}`);
                }
            }

        } catch (error) {
            console.error('[PacketListener] Error removing role from user:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_remove_role',
                discord_id: discordId,
                rank_id: rankId
            });
        }
    }

    private async getRankInfo(rankId: string): Promise<any> {
        try {
            const apiUrl = serverUtils.getApi().baseUrl + serverUtils.getApi().endpoints.rank.replace('{rankId}', rankId);
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                console.warn(`[PacketListener] Failed to fetch rank info for ${rankId}`);
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('[PacketListener] Error fetching rank info:', error);
            return null;
        }
    }

    private async getGuilds(): Promise<any[]> {
        if (!(this as any).client) {
            console.warn('[PacketListener] Discord client not set');
            return [];
        }
        return Array.from((this as any).client.guilds.cache.values());
    }

    public setClient(client: any): void {
        // Store reference to Discord client for accessing guilds
        (this as any).client = client;
    }

    private async handleUuidCacheUpdate(data: any): Promise<void> {
        try {
            if (!data._id || !data.username) {
                console.warn('[PacketListener] UUID cache update packet missing required data');
                return;
            }

            // Update the UUID cache in the LeaderboardService
            const { leaderboardService } = await import('./LeaderboardService');
            leaderboardService.updateUuidCache(data._id, data.username);
            
            console.log(`[PacketListener] Updated UUID cache: ${data._id} -> ${data.username}`);
        } catch (error) {
            console.error('[PacketListener] Error handling UUID cache update packet:', error);
            sentryService.captureException(error as Error, {
                context: 'packet_uuid_cache_update',
                data: data
            });
        }
    }
}

export const packetListenerService = PacketListenerService.getInstance();
