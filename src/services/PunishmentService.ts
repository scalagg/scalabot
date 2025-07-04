import { GuildMember, Client, EmbedBuilder, TextChannel } from 'discord.js';
import { checkActivePunishments } from '../utils/minecraftUtils';
import { mongoService } from './MongoService';
import { config } from '../config/config';
import type { Document } from 'mongodb';

interface BaseDiscordProfile {
    _id: string;
    claimedInitialLinkAward: boolean;
    completedInitialSave: boolean | null;
    discordId: string | null;
    identifier: string;
    lastCachedDiscordUsername: string | null;
    notifiedOfSuccessfulLink: boolean;
}

type DiscordProfile = BaseDiscordProfile & Document;

class PunishmentService {
    private client: Client;
    private checkInterval: NodeJS.Timeout | null = null;
    private static instance: PunishmentService | null = null;

    private constructor(client: Client) {
        this.client = client;
    }

    public static initialize(client: Client): PunishmentService {
        if (!PunishmentService.instance) {
            PunishmentService.instance = new PunishmentService(client);
        }
        return PunishmentService.instance;
    }

    public static getInstance(): PunishmentService {
        if (!PunishmentService.instance) {
            throw new Error('PunishmentService not initialized');
        }
        return PunishmentService.instance;
    }

    /**
     * Start periodic punishment checks
     */
    public startPeriodicChecks(intervalMinutes: number = 5) {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        this.checkInterval = setInterval(() => this.checkAllMembers(), intervalMinutes * 60 * 1000);
        console.log(`[PunishmentService] Started periodic checks every ${intervalMinutes} minutes`);
    }

    /**
     * Stop periodic punishment checks
     */
    public stopPeriodicChecks() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('[PunishmentService] Stopped periodic checks');
        }
    }

    /**
     * Send a log message to the punishment logs channel
     */
    private async sendPunishmentLog(
        member: GuildMember,
        minecraftUuid: string,
        type: 'ban' | 'unban' | 'mute' | 'unmute' | 'blacklist',
        reason?: string,
        expiryTimestamp?: number
    ) {
        try {
            const channel = await this.client.channels.fetch(config.punishmentLogsChannelId);
            if (!channel || !(channel instanceof TextChannel)) {
                console.error('[PunishmentService] Could not find punishment logs channel');
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(type === 'ban' || type === 'mute' || type === 'blacklist' ? '#FF0000' : '#00FF00')
                .setTitle(`🔨 Discord Sync: ${type.charAt(0).toUpperCase() + type.slice(1)}`)
                .setDescription(`Discord roles have been updated to reflect in-game punishment status.`)
                .addFields(
                    { name: 'User', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
                    { name: 'Minecraft UUID', value: minecraftUuid, inline: true }
                )
                .setTimestamp();

            if (reason) {
                embed.addFields({ name: 'Reason', value: reason });
            }

            if (expiryTimestamp) {
                embed.addFields({ name: 'Expires', value: `<t:${expiryTimestamp}:R>` });
            }

            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[PunishmentService] Error sending punishment log:', error);
        }
    }

    /**
     * Send a DM to a user about their punishment
     */
    private async sendPunishmentDM(
        member: GuildMember,
        type: 'ban' | 'mute' | 'blacklist',
        reason: string,
        expiryTimestamp?: number
    ) {
        try {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('⚠️ Account Punishment Detected')
                .setDescription('Your Discord account has been restricted due to an in-game punishment.')
                .addFields(
                    { 
                        name: 'Type', 
                        value: type.charAt(0).toUpperCase() + type.slice(1), 
                        inline: true 
                    },
                    { 
                        name: 'Reason', 
                        value: reason, 
                        inline: true 
                    }
                )
                .setFooter({ text: 'If you believe this is a mistake, please create a ticket for assistance.' });

            if (expiryTimestamp && expiryTimestamp !== Number.MAX_SAFE_INTEGER) {
                embed.addFields({
                    name: 'Expires',
                    value: `<t:${Math.floor(expiryTimestamp / 1000)}:R>`,
                    inline: true
                });
            }

            await member.send({ embeds: [embed] }).catch(error => {
                console.error(`[PunishmentService] Failed to send DM to ${member.user.tag}:`, error);
            });
        } catch (error) {
            console.error(`[PunishmentService] Error sending punishment DM to ${member.user.tag}:`, error);
        }
    }

    /**
     * Send a DM to a user when their punishment expires
     */
    private async sendPunishmentExpiredDM(
        member: GuildMember,
        type: 'ban' | 'mute' | 'blacklist'
    ) {
        try {
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Punishment Expired')
                .setDescription(`The ${type} associated with your account has been lifted.`)
                .setTimestamp();

            await member.send({ embeds: [embed] }).catch(error => {
                console.error(`[PunishmentService] Failed to send expiry DM to ${member.user.tag}:`, error);
            });
        } catch (error) {
            console.error(`[PunishmentService] Error sending punishment expiry DM to ${member.user.tag}:`, error);
        }
    }

    /**
     * Check all members for punishment updates
     */
    private async checkAllMembers() {
        try {
            console.log('[PunishmentService] Running periodic punishment check...');
            
            // Get all verified Discord profiles
            await mongoService.connect();
            const profiles = mongoService.getCollection<DiscordProfile>('DiscordProfile');
            const verifiedProfiles = await profiles.find({ discordId: { $ne: null } }).toArray();

            let updatedCount = 0;
            for (const profile of verifiedProfiles) {
                if (!profile.discordId) continue;

                try {
                    // Find the member in all guilds
                    for (const guild of this.client.guilds.cache.values()) {
                        const member = await guild.members.fetch(profile.discordId).catch(() => null);
                        if (member) {
                            const wasUpdated = await this.updateMemberRoles(member, profile.identifier);
                            if (wasUpdated) updatedCount++;
                        }
                    }
                } catch (error) {
                    console.error(`[PunishmentService] Error checking member ${profile.discordId}:`, error);
                }
            }

            console.log(`[PunishmentService] Periodic check complete. Updated ${updatedCount} members.`);
        } catch (error) {
            console.error('[PunishmentService] Error during periodic check:', error);
        }
    }

    /**
     * Updates a member's roles based on their in-game punishment status
     */
    public async updateMemberRoles(member: GuildMember, uuid: string) {
        try {
            console.log(`[PunishmentService] Checking punishments for ${member.user.tag} (${uuid})`);
            const punishments = await checkActivePunishments(uuid);
            console.log(`[PunishmentService] Punishment status for ${member.user.tag}:`, punishments);

            const verifiedRole = member.guild.roles.cache.find(role => 
                role.name.toLowerCase() === 'member' || 
                role.name.toLowerCase() === 'verified'
            );

            const restrictedRole = member.guild.roles.cache.find(role => 
                role.name === 'Restricted Access'
            );

            if (!verifiedRole) {
                console.error(`[PunishmentService] Could not find Member/Verified role in guild ${member.guild.name}`);
                return false;
            }

            if (!restrictedRole) {
                console.error(`[PunishmentService] Could not find Restricted Access role in guild ${member.guild.name}`);
                return false;
            }

            console.log(`[PunishmentService] Found Member role: ${verifiedRole.name}`);
            console.log(`[PunishmentService] Found Restricted role: ${restrictedRole.name}`);
            let wasUpdated = false;

            // Check if any punishment is permanent (very long duration)
            const isPermanent = (duration?: number) => duration && duration > 31536000000; // More than 1 year
            const hasPermanentPunishment = isPermanent(punishments.banExpiry) || 
                                         isPermanent(punishments.blacklistExpiry) || 
                                         isPermanent(punishments.muteExpiry);

            // Store previous punishment state to detect changes
            const hadVerifiedRole = member.roles.cache.has(verifiedRole.id);
            const hadRestrictedRole = member.roles.cache.has(restrictedRole.id);
            const wasTimedOut = member.communicationDisabledUntil && member.communicationDisabledUntil.getTime() > Date.now();

            // Handle blacklist and ban status
            if (punishments.isBlacklisted || punishments.isBanned) {
                console.log(`[PunishmentService] User ${member.user.tag} is ${punishments.isBlacklisted ? 'blacklisted' : 'banned'}`);
                
                // Remove verified role if they have it
                if (member.roles.cache.has(verifiedRole.id)) {
                    await member.roles.remove(verifiedRole);
                    wasUpdated = true;
                }

                // Add restricted role if permanent punishment and they don't have it
                if (hasPermanentPunishment && !member.roles.cache.has(restrictedRole.id)) {
                    await member.roles.add(restrictedRole);
                    wasUpdated = true;
                }
                // Remove restricted role if temporary punishment and they have it
                else if (!hasPermanentPunishment && member.roles.cache.has(restrictedRole.id)) {
                    await member.roles.remove(restrictedRole);
                    wasUpdated = true;
                }

                // Send DM if this is a new punishment (they previously had verified role)
                if (hadVerifiedRole) {
                    await this.sendPunishmentDM(
                        member,
                        punishments.isBlacklisted ? 'blacklist' : 'ban',
                        punishments.isBlacklisted ? punishments.blacklistReason! : punishments.banReason!,
                        punishments.isBlacklisted ? punishments.blacklistExpiry : punishments.banExpiry
                    );
                }

                if (wasUpdated) {
                    await this.sendPunishmentLog(
                        member,
                        uuid,
                        punishments.isBlacklisted ? 'blacklist' : 'ban',
                        punishments.isBlacklisted ? punishments.blacklistReason : punishments.banReason,
                        punishments.isBlacklisted ? 
                            (punishments.blacklistExpiry ? Math.floor(punishments.blacklistExpiry / 1000) : undefined) :
                            (punishments.banExpiry ? Math.floor(punishments.banExpiry / 1000) : undefined)
                    );
                }
            } else {
                console.log(`[PunishmentService] User ${member.user.tag} is not banned/blacklisted`);
                // Add verified role if they don't have it
                if (!member.roles.cache.has(verifiedRole.id)) {
                    await member.roles.add(verifiedRole);
                    wasUpdated = true;
                }
                // Remove restricted role if they have it
                if (member.roles.cache.has(restrictedRole.id)) {
                    await member.roles.remove(restrictedRole);
                    wasUpdated = true;
                }

                // Send DM if their punishment was just lifted (they previously had restricted role)
                if (hadRestrictedRole) {
                    await this.sendPunishmentExpiredDM(member, 'ban');
                }

                if (wasUpdated) {
                    await this.sendPunishmentLog(member, uuid, 'unban');
                }
            }

            // Handle mute status using Discord timeouts
            if (punishments.isMuted) {
                console.log(`[PunishmentService] User ${member.user.tag} is muted, applying/renewing timeout`);
                const timeoutDuration = punishments.muteExpiry 
                    ? Math.min(punishments.muteExpiry - Date.now(), 2419200000) // Cap at 28 days (Discord's max)
                    : 2419200000; // If no expiry or permanent, use max duration

                // Send DM if this is a new mute (they weren't timed out before)
                if (!wasTimedOut) {
                    await this.sendPunishmentDM(
                        member,
                        'mute',
                        punishments.muteReason!,
                        punishments.muteExpiry
                    );
                }

                // Always renew timeout to maintain full duration
                await member.timeout(timeoutDuration, punishments.muteReason || 'In-game mute sync');
                await this.sendPunishmentLog(
                    member,
                    uuid,
                    'mute',
                    punishments.muteReason,
                    punishments.muteExpiry ? Math.floor(punishments.muteExpiry / 1000) : undefined
                );
                wasUpdated = true;
            } else {
                console.log(`[PunishmentService] User ${member.user.tag} is not muted, checking timeout status`);
                if (member.communicationDisabledUntil && member.communicationDisabledUntil.getTime() > Date.now()) {
                    await member.timeout(null); // Remove timeout
                    await this.sendPunishmentLog(member, uuid, 'unmute');
                    // Send DM when mute expires
                    await this.sendPunishmentExpiredDM(member, 'mute');
                    wasUpdated = true;
                }
            }

            return wasUpdated;
        } catch (error) {
            console.error(`[PunishmentService] Error updating roles for ${member.user.tag}:`, error);
            return false;
        }
    }

    /**
     * Checks if a user can verify based on their punishment status
     */
    public async canVerify(uuid: string): Promise<{
        canVerify: boolean;
        reason?: string;
        expiryTimestamp?: number;
    }> {
        try {
            const punishments = await checkActivePunishments(uuid);
            
            if (punishments.isBlacklisted || punishments.isBanned) {
                const isBlacklisted = punishments.isBlacklisted;
                const expiry = isBlacklisted ? punishments.blacklistExpiry : punishments.banExpiry;
                const reason = isBlacklisted ? punishments.blacklistReason : punishments.banReason;
                
                const expiryText = expiry && expiry !== Number.MAX_SAFE_INTEGER
                    ? Math.floor(expiry / 1000)
                    : undefined;

                return {
                    canVerify: false,
                    reason: reason,
                    expiryTimestamp: expiryText
                };
            }

            return { canVerify: true };
        } catch (error) {
            console.error('[PunishmentService] Error checking verification status:', error);
            throw error;
        }
    }

    /**
     * Manually check punishments for a specific Discord user ID
     */
    public async checkSpecificUser(discordId: string) {
        try {
            console.log(`[PunishmentService] Manually checking user: ${discordId}`);
            await mongoService.connect();
            const profiles = mongoService.getCollection<DiscordProfile>('DiscordProfile');
            const profile = await profiles.findOne({ discordId });

            if (!profile) {
                console.log(`[PunishmentService] No profile found for Discord ID: ${discordId}`);
                return false;
            }

            console.log(`[PunishmentService] Found profile for ${discordId}:`, {
                uuid: profile.identifier,
                discordId: profile.discordId,
                lastUsername: profile.lastCachedDiscordUsername
            });

            let wasUpdated = false;
            for (const guild of this.client.guilds.cache.values()) {
                const member = await guild.members.fetch(discordId).catch(() => null);
                if (member) {
                    console.log(`[PunishmentService] Found member in guild: ${guild.name}`);
                    wasUpdated = await this.updateMemberRoles(member, profile.identifier);
                } else {
                    console.log(`[PunishmentService] Member not found in guild: ${guild.name}`);
                }
            }
            return wasUpdated;
        } catch (error) {
            console.error('[PunishmentService] Error during manual check:', error);
            throw error;
        }
    }

    /**
     * Get current punishment status for a UUID
     */
    public async getCurrentPunishmentStatus(uuid: string) {
        return await checkActivePunishments(uuid);
    }

    /**
     * Send a DM with current punishment status
     */
    public async sendCurrentStatusDM(
        member: GuildMember,
        punishments: {
            isBanned: boolean;
            isMuted: boolean;
            isBlacklisted: boolean;
            banExpiry?: number;
            muteExpiry?: number;
            blacklistExpiry?: number;
            banReason?: string;
            muteReason?: string;
            blacklistReason?: string;
        }
    ) {
        try {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('⚠️ Current Account Status')
                .setDescription('Your account currently has active punishments.');

            if (punishments.isBlacklisted) {
                embed.addFields({
                    name: '🚫 Blacklisted',
                    value: `Reason: ${punishments.blacklistReason || 'No reason provided'}${
                        punishments.blacklistExpiry && punishments.blacklistExpiry !== Number.MAX_SAFE_INTEGER
                            ? `\nExpires: <t:${Math.floor(punishments.blacklistExpiry / 1000)}:R>`
                            : '\nDuration: Permanent'
                    }`
                });
            }

            if (punishments.isBanned) {
                embed.addFields({
                    name: '🔨 Banned',
                    value: `Reason: ${punishments.banReason || 'No reason provided'}${
                        punishments.banExpiry && punishments.banExpiry !== Number.MAX_SAFE_INTEGER
                            ? `\nExpires: <t:${Math.floor(punishments.banExpiry / 1000)}:R>`
                            : '\nDuration: Permanent'
                    }`
                });
            }

            if (punishments.isMuted) {
                embed.addFields({
                    name: '🔇 Muted',
                    value: `Reason: ${punishments.muteReason || 'No reason provided'}${
                        punishments.muteExpiry && punishments.muteExpiry !== Number.MAX_SAFE_INTEGER
                            ? `\nExpires: <t:${Math.floor(punishments.muteExpiry / 1000)}:R>`
                            : '\nDuration: Permanent'
                    }`
                });
            }

            embed.setFooter({ text: 'If you believe this is a mistake, please create a ticket for assistance.' });

            await member.send({ embeds: [embed] }).catch(error => {
                console.error(`[PunishmentService] Failed to send status DM to ${member.user.tag}:`, error);
            });
        } catch (error) {
            console.error(`[PunishmentService] Error sending status DM to ${member.user.tag}:`, error);
        }
    }
}

export { PunishmentService }; 