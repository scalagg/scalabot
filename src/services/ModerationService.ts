import { GuildMember, Client, EmbedBuilder, TextChannel, User, ColorResolvable } from 'discord.js';
import { mongoService } from './MongoService';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';
import type { Document, ObjectId } from 'mongodb';

interface ModerationAction {
    _id: string;
    punishmentId: string;
    guildId: string;
    userId: string;
    moderatorId: string;
    action: 'ban' | 'tempban' | 'unban' | 'timeout' | 'mute' | 'unmute' | 'warn' | 'kick';
    reason: string;
    duration?: number; // Duration in milliseconds
    expiresAt?: Date;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    evidence?: string;
    appealable: boolean;
}

export interface CreateModerationActionParams {
    guildId: string;
    userId: string;
    moderatorId: string;
    action: BaseModerationAction['action'];
    reason: string;
    duration?: number;
    evidence?: string;
    appealable?: boolean;
}

export class ModerationService {
    private static instance: ModerationService;
    private client!: Client;

    private constructor() {}

    public static getInstance(): ModerationService {
        if (!ModerationService.instance) {
            ModerationService.instance = new ModerationService();
        }
        return ModerationService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
        // Start all expiry checkers when client is set
        this.startExpiryCheckers(client);
    }

    private generatePunishmentId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `PUN-${timestamp}-${random}`.toUpperCase();
    }

    private async getCollection() {
        await mongoService.connect();
        return mongoService.getCollection('ModerationActions');
    }

    public async createModerationAction(params: {
        guildId: string;
        userId: string;
        moderatorId: string;
        action: ModerationAction['action'];
        reason: string;
        duration?: number;
        evidence?: string;
        appealable?: boolean;
    }): Promise<ModerationAction> {
        const collection = await this.getCollection();
        
        const punishmentId = this.generatePunishmentId();
        const now = new Date();
        const expiresAt = params.duration ? new Date(now.getTime() + params.duration) : undefined;

        const moderationAction = {
            punishmentId,
            guildId: params.guildId,
            userId: params.userId,
            moderatorId: params.moderatorId,
            action: params.action,
            reason: params.reason,
            duration: params.duration,
            expiresAt,
            active: true,
            createdAt: now,
            updatedAt: now,
            evidence: params.evidence,
            appealable: params.appealable ?? true
        };

        const result = await collection.insertOne(moderationAction);
        return { ...moderationAction, _id: result.insertedId.toString() };
    }

    public async deactivateAction(punishmentId: string, moderatorId: string, reason: string): Promise<void> {
        const collection = await this.getCollection();
        
        await collection.updateOne(
            { punishmentId, active: true },
            {
                $set: {
                    active: false,
                    updatedAt: new Date()
                },
                $push: {
                    history: {
                        action: 'deactivated',
                        moderatorId,
                        reason,
                        timestamp: new Date()
                    }
                }
            }
        );
    }

    public async getActiveActions(userId: string, guildId: string): Promise<ModerationAction[]> {
        const collection = await this.getCollection();
        
        return collection.find({
            userId,
            guildId,
            active: true,
            $or: [
                { expiresAt: { $exists: false } }, // Permanent actions (no expiresAt field)
                { expiresAt: null }, // Permanent actions (expiresAt is null)
                { expiresAt: { $gt: new Date() } } // Not yet expired
            ]
        }).toArray();
    }

    /**
     * Get active mutes for a user (including permanent mutes)
     */
    public async getActiveMutes(userId: string, guildId: string): Promise<ModerationAction[]> {
        const collection = await this.getCollection();
        
        return collection.find({
            userId,
            guildId,
            action: 'mute',
            active: true,
            $or: [
                { expiresAt: { $exists: false } }, // Permanent mutes (no expiresAt field)
                { expiresAt: null }, // Permanent mutes (expiresAt is null)
                { expiresAt: { $gt: new Date() } } // Not yet expired
            ]
        }).toArray();
    }

    public async getActionByPunishmentId(punishmentId: string): Promise<ModerationAction | null> {
        const collection = await this.getCollection();
        
        return collection.findOne({ punishmentId });
    }

    public async getUserHistory(userId: string, guildId: string): Promise<ModerationAction[]> {
        const collection = await this.getCollection();
        
        return collection.find({
            userId,
            guildId
        }).sort({ createdAt: -1 }).toArray();
    }

    public async sendModerationLog(
        action: ModerationAction,
        targetUser: User,
        moderator: GuildMember,
        additionalInfo?: { duration?: string; evidence?: string }
    ): Promise<void> {
        try {
            const channel = await this.client.channels.fetch(config.punishmentLogsChannelId);
            if (!channel || !(channel instanceof TextChannel)) {
                console.error('[ModerationService] Could not find punishment logs channel');
                return;
            }

            // Set server type based on guild ID
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(action.guildId));

            const embed = new EmbedBuilder()
                .setColor(this.getActionColor(action.action))
                .setTitle(`🔨 ${action.action.toUpperCase()} - ${action.punishmentId}`)
                .setDescription(`**${targetUser.tag}** has been ${action.action}${action.duration ? ' temporarily' : ''}`)
                .addFields(
                    { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                    { name: '🛡️ Moderator', value: `${moderator.user.tag} (<@${moderator.id}>)`, inline: true },
                    { name: '📝 Reason', value: action.reason, inline: false }
                )
                .setTimestamp();

            if (additionalInfo?.duration) {
                embed.addFields({ name: '⏰ Duration', value: additionalInfo.duration, inline: true });
            }

            if (additionalInfo?.evidence) {
                embed.addFields({ name: '📋 Evidence', value: additionalInfo.evidence, inline: false });
            }

            if (action.expiresAt) {
                embed.addFields({ 
                    name: '⏰ Expires', 
                    value: `<t:${Math.floor(action.expiresAt.getTime() / 1000)}:R>`, 
                    inline: true 
                });
            }

            embed.setFooter(serverUtils.getFooter());

            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[ModerationService] Error sending moderation log:', error);
        }
    }

    public async sendModerationDM(
        action: ModerationAction,
        targetUser: User,
        moderator: GuildMember,
        duration?: string
    ): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(this.getActionColor(action.action))
                .setTitle(`⚠️ Account ${action.action.toUpperCase()}`)
                .setDescription(`Your account has been ${action.action} on **${moderator.guild.name}**`)
                .addFields(
                    { name: '🛡️ Moderator', value: moderator.user.tag, inline: true },
                    { name: '📝 Reason', value: action.reason, inline: false }
                )
                .setFooter({ 
                    text: `Punishment ID: ${action.punishmentId} • Appealable: ${action.appealable ? 'Yes' : 'No'}` 
                })
                .setTimestamp();

            if (duration) {
                embed.addFields({ name: '⏰ Duration', value: duration, inline: true });
            }

            if (action.expiresAt) {
                embed.addFields({ 
                    name: '⏰ Expires', 
                    value: `<t:${Math.floor(action.expiresAt.getTime() / 1000)}:R>`, 
                    inline: true 
                });
            }

            await targetUser.send({ embeds: [embed] });
        } catch (error) {
            console.error(`[ModerationService] Error sending DM to ${targetUser.tag}:`, error);
        }
    }

    private getActionColor(action: ModerationAction['action']): ColorResolvable {
        switch (action) {
            case 'ban':
            case 'tempban':
                return '#FF0000' as ColorResolvable; // Red
            case 'timeout':
            case 'mute':
                return '#FFA500' as ColorResolvable; // Orange
            case 'warn':
                return '#FFFF00' as ColorResolvable; // Yellow
            case 'kick':
                return '#FF6B6B' as ColorResolvable; // Light red
            case 'unban':
            case 'unmute':
                return '#00FF00' as ColorResolvable; // Green
            default:
                return '#7289DA' as ColorResolvable; // Discord blurple
        }
    }

    public formatDuration(durationMs: number): string {
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days} day${days !== 1 ? 's' : ''}`;
        } else if (hours > 0) {
            return `${hours} hour${hours !== 1 ? 's' : ''}`;
        } else if (minutes > 0) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
            return `${seconds} second${seconds !== 1 ? 's' : ''}`;
        }
    }

    public parseDuration(duration: string): number | null {
        const match = duration.match(/^(\d+)(s|m|h|d)$/i);
        if (!match) return null;

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        switch (unit) {
            case 's': return value * 1000; // seconds
            case 'm': return value * 60 * 1000; // minutes
            case 'h': return value * 60 * 60 * 1000; // hours
            case 'd': return value * 24 * 60 * 60 * 1000; // days
            default: return null;
        }
    }

    /**
     * Start background jobs to check for expired punishments
     */
    public startExpiryCheckers(client: Client) {
        console.log('[ModerationService] Starting expiry checkers...');
        
        // Start mute expiry checker
        this.startMuteExpiryChecker(client);
        
        // Start tempban expiry checker
        this.startTempbanExpiryChecker(client);
    }

    /**
     * Start a background job to check for expired mutes and remove the muted role
     */
    private startMuteExpiryChecker(client: Client) {
        console.log('[ModerationService] Starting mute expiry checker...');
        
        setInterval(async () => {
            try {
                const collection = await this.getCollection();
                const now = new Date();
                
                // Find all active mutes that have expired (excluding permanent mutes)
                const expiredMutes = await collection.find({
                    action: 'mute',
                    active: true,
                    expiresAt: { $exists: true, $lte: now }
                }).toArray();
                
                if (expiredMutes.length > 0) {
                    console.log(`[MuteExpiry] Found ${expiredMutes.length} expired mutes to process.`);
                }
                
                for (const mute of expiredMutes) {
                    try {
                        console.log(`[MuteExpiry] Processing mute: punishmentId=${mute.punishmentId}, userId=${mute.userId}, guildId=${mute.guildId}`);
                        
                        const guild = client.guilds.cache.get(mute.guildId);
                        if (!guild) {
                            console.log(`[MuteExpiry] Guild not found: ${mute.guildId}`);
                            continue;
                        }
                        
                        const member = await guild.members.fetch(mute.userId).catch(() => null);
                        if (!member) {
                            console.log(`[MuteExpiry] Member not found: ${mute.userId}`);
                            continue;
                        }
                        
                        // Find muted role
                        const mutedRole = guild.roles.cache.find(role => 
                            role.name.toLowerCase() === 'muted' || 
                            role.name.toLowerCase() === 'mute'
                        );
                        
                        if (!mutedRole) {
                            console.log(`[MuteExpiry] Muted role not found in guild: ${guild.id}`);
                            continue;
                        }
                        
                        // Check if user still has the muted role
                        if (!member.roles.cache.has(mutedRole.id)) {
                            console.log(`[MuteExpiry] Member does not have muted role: ${mute.userId}`);
                            // Mark as inactive anyway since it's expired
                            await collection.updateOne(
                                { punishmentId: mute.punishmentId },
                                { $set: { active: false, updatedAt: new Date() } }
                            );
                            continue;
                        }
                        
                        // Remove the muted role
                        await member.roles.remove(mutedRole, `Mute expired - Punishment ID: ${mute.punishmentId}`);
                        console.log(`[MuteExpiry] Removed muted role from user: ${mute.userId}`);
                        
                        // Mark the mute as inactive
                        await collection.updateOne(
                            { punishmentId: mute.punishmentId },
                            { $set: { active: false, updatedAt: new Date() } }
                        );
                        console.log(`[MuteExpiry] Marked mute as inactive in DB: ${mute.punishmentId}`);
                        
                        // Send log to moderation channel
                        await this.sendExpiryLog(client, mute, member);
                        
                    } catch (error) {
                        console.error(`[MuteExpiry] Error processing mute ${mute.punishmentId}:`, error);
                    }
                }
            } catch (err) {
                console.error('[ModerationService] Error in mute expiry checker:', err);
            }
        }, 60 * 1000); // Check every minute
    }

    /**
     * Start a background job to check for expired tempbans and unban users
     */
    private startTempbanExpiryChecker(client: Client) {
        console.log('[ModerationService] Starting tempban expiry checker...');
        
        setInterval(async () => {
            try {
                const collection = await this.getCollection();
                const now = new Date();
                
                // Find all active tempbans that have expired
                const expiredTempbans = await collection.find({
                    action: 'tempban',
                    active: true,
                    expiresAt: { $exists: true, $lte: now }
                }).toArray();
                
                if (expiredTempbans.length > 0) {
                    console.log(`[TempbanExpiry] Found ${expiredTempbans.length} expired tempbans to process.`);
                }
                
                for (const tempban of expiredTempbans) {
                    try {
                        console.log(`[TempbanExpiry] Processing tempban: punishmentId=${tempban.punishmentId}, userId=${tempban.userId}, guildId=${tempban.guildId}`);
                        
                        const guild = client.guilds.cache.get(tempban.guildId);
                        if (!guild) {
                            console.log(`[TempbanExpiry] Guild not found: ${tempban.guildId}`);
                            continue;
                        }
                        
                        // Check if user is still banned
                        const ban = await guild.bans.fetch(tempban.userId).catch(() => null);
                        if (!ban) {
                            console.log(`[TempbanExpiry] User is not banned: ${tempban.userId}`);
                            // Mark as inactive anyway since it's expired
                            await collection.updateOne(
                                { punishmentId: tempban.punishmentId },
                                { $set: { active: false, updatedAt: new Date() } }
                            );
                            continue;
                        }
                        
                        // Unban the user (handle case where user is already unbanned)
                        try {
                            await guild.members.unban(tempban.userId, `Tempban expired - Punishment ID: ${tempban.punishmentId}`);
                            console.log(`[TempbanExpiry] Unbanned user: ${tempban.userId}`);
                        } catch (unbanError: any) {
                            if (unbanError.code === 10026) {
                                // User is already unbanned (Unknown Ban error)
                                console.log(`[TempbanExpiry] User ${tempban.userId} was already unbanned`);
                            } else {
                                // Some other error occurred
                                console.error(`[TempbanExpiry] Error unbaning user ${tempban.userId}:`, unbanError);
                                continue;
                            }
                        }
                        
                        // Mark the tempban as inactive
                        await collection.updateOne(
                            { punishmentId: tempban.punishmentId },
                            { $set: { active: false, updatedAt: new Date() } }
                        );
                        console.log(`[TempbanExpiry] Marked tempban as inactive in DB: ${tempban.punishmentId}`);
                        
                        // Send log to moderation channel
                        await this.sendTempbanExpiryLog(client, tempban);
                        
                    } catch (error) {
                        console.error(`[TempbanExpiry] Error processing tempban ${tempban.punishmentId}:`, error);
                    }
                }
            } catch (err) {
                console.error('[ModerationService] Error in tempban expiry checker:', err);
            }
        }, 60 * 1000); // Check every minute
    }

    /**
     * Send log message when a mute expires
     */
    private async sendExpiryLog(client: Client, mute: any, member: GuildMember) {
        try {
            const logChannelId = config.punishmentLogsChannelId;
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
            
            if (logChannel && logChannel.isTextBased() && logChannel instanceof TextChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('🔊 User Unmuted (Auto)')
                    .setDescription(`**${member.user.tag}** has been automatically unmuted (mute expired).`)
                    .addFields(
                        { name: '👤 User', value: `${member.user.tag} (<@${mute.userId}>)`, inline: true },
                        { name: '🆔 Punishment ID', value: mute.punishmentId, inline: true },
                        { name: '⏰ Expired At', value: mute.expiresAt ? `<t:${Math.floor(new Date(mute.expiresAt).getTime() / 1000)}:F>` : 'Unknown', inline: true }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await logChannel.send({ embeds: [embed] });
                console.log(`[MuteExpiry] Sent unmute log for user: ${mute.userId}`);
            }
        } catch (error) {
            console.error(`[MuteExpiry] Error sending expiry log for ${mute.punishmentId}:`, error);
        }
    }

    /**
     * Send log message when a tempban expires
     */
    private async sendTempbanExpiryLog(client: Client, tempban: any) {
        try {
            const logChannelId = config.punishmentLogsChannelId;
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
            
            if (logChannel && logChannel.isTextBased() && logChannel instanceof TextChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('🔓 User Unbanned (Auto)')
                    .setDescription(`**User ID: ${tempban.userId}** has been automatically unbanned (tempban expired).`)
                    .addFields(
                        { name: '👤 User ID', value: tempban.userId, inline: true },
                        { name: '🆔 Punishment ID', value: tempban.punishmentId, inline: true },
                        { name: '⏰ Expired At', value: tempban.expiresAt ? `<t:${Math.floor(new Date(tempban.expiresAt).getTime() / 1000)}:F>` : 'Unknown', inline: true }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await logChannel.send({ embeds: [embed] });
                console.log(`[TempbanExpiry] Sent unban log for user: ${tempban.userId}`);
            }
        } catch (error) {
            console.error(`[TempbanExpiry] Error sending expiry log for ${tempban.punishmentId}:`, error);
        }
    }
}

export const moderationService = ModerationService.getInstance(); 