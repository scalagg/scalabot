import { GuildMember, TextChannel, EmbedBuilder } from 'discord.js';
import { sentryService } from './SentryService';
import { serverUtils } from '../utils/ServerUtils';

interface SyncRequest {
    code: string;
    discordId: string;
    timestamp: number;
    discriminator: string;
}

interface SyncResponse {
    username: string;
    role?: string;
}

interface ApiResponse<T> {
    value: T;
    success: boolean;
}

export class SyncService {
    private static instance: SyncService;
    private performing: Set<string> = new Set();

    private constructor() {}

    public static getInstance(): SyncService {
        if (!SyncService.instance) {
            SyncService.instance = new SyncService();
        }
        return SyncService.instance;
    }

    public async requestSync(request: SyncRequest): Promise<ApiResponse<SyncResponse> | null> {
        try {
            const apiUrl = serverUtils.getApi().baseUrl + '/discord/sync';
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(request),
            });

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('[SyncService] Error requesting sync:', error);
            sentryService.captureException(error as Error, {
                context: 'sync_request',
                discord_id: request.discordId,
                code: request.code
            });
            return null;
        }
    }

    public isPerforming(discordId: string): boolean {
        return this.performing.has(discordId);
    }

    public addPerforming(discordId: string): void {
        this.performing.add(discordId);
    }

    public removePerforming(discordId: string): void {
        this.performing.delete(discordId);
    }

    public async addRoleToMember(member: GuildMember, roleId: string): Promise<boolean> {
        try {
            const role = member.guild.roles.cache.get(roleId);
            if (!role) {
                console.warn(`[SyncService] Role ${roleId} not found in guild ${member.guild.id}`);
                return false;
            }

            await member.roles.add(role, 'Account sync');
            console.log(`[SyncService] Added role ${role.name} to user ${member.user.tag}`);
            return true;
        } catch (error) {
            console.error('[SyncService] Error adding role to member:', error);
            sentryService.captureException(error as Error, {
                context: 'sync_add_role',
                user_id: member.id,
                guild_id: member.guild.id,
                role_id: roleId
            });
            return false;
        }
    }

    public async removeRoleFromMember(member: GuildMember, roleId: string): Promise<boolean> {
        try {
            const role = member.guild.roles.cache.get(roleId);
            if (!role) {
                console.warn(`[SyncService] Role ${roleId} not found in guild ${member.guild.id}`);
                return false;
            }

            await member.roles.remove(role, 'Account sync removal');
            console.log(`[SyncService] Removed role ${role.name} from user ${member.user.tag}`);
            return true;
        } catch (error) {
            console.error('[SyncService] Error removing role from member:', error);
            sentryService.captureException(error as Error, {
                context: 'sync_remove_role',
                user_id: member.id,
                guild_id: member.guild.id,
                role_id: roleId
            });
            return false;
        }
    }

    public async sendTemporaryMessage(channel: TextChannel, message: string, duration: number = 5000): Promise<void> {
        try {
            const sentMessage = await channel.send(message);
            setTimeout(async () => {
                try {
                    await sentMessage.delete();
                } catch (error) {
                    console.warn('[SyncService] Could not delete temporary message:', error);
                }
            }, duration);
        } catch (error) {
            console.error('[SyncService] Error sending temporary message:', error);
            sentryService.captureException(error as Error, {
                context: 'sync_temp_message',
                channel_id: channel.id,
                guild_id: channel.guild.id
            });
        }
    }

    public createSyncEmbed(): EmbedBuilder {
        const serverInfo = serverUtils.getInfo();
        const theme = serverUtils.getTheme();

        return new EmbedBuilder()
            .setTitle('How can I sync my account?')
            .setColor(theme.primary)
            .setTimestamp()
            .addFields({
                name: '',
                value: `>>> **#1**. Connect to our server using **__${serverInfo.ip.toUpperCase()}__**.\n**#2**. Type /sync on any server.\n**#3**. You will be prompted an 8-digit code.\n**#4**. Type !sync <code> in this channel to finish.`,
                inline: false
            })
            .setImage('https://i.imgur.com/example.png') // Replace with your background image
            .setFooter({ 
                text: `Powered by ${serverInfo.name}`, 
                iconURL: serverInfo.logo 
            });
    }
}

export const syncService = SyncService.getInstance();
