import { 
    Client, 
    GuildMember, 
    TextChannel, 
    EmbedBuilder, 
    AuditLogEvent,
    PermissionFlagsBits,
    GuildBan,
    Channel,
    Role
} from 'discord.js';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';
import { moderationService } from './ModerationService';
import { sentryService } from './SentryService';

interface ActionEvent {
    executorId: string;
    executorTag: string;
    action: string;
    target?: string;
    timestamp: number;
    guildId: string;
}

interface NukeDetection {
    isNuke: boolean;
    executorId: string;
    executorTag: string;
    actionCount: number;
    timeWindow: number;
    actionType: string;
    reason: string;
}

export class AntiNukeService {
    private static instance: AntiNukeService;
    private client!: Client;
    private actionEvents: Map<string, ActionEvent[]> = new Map(); // guildId -> events
    private isInitialized = false;

    // Configuration
    private readonly MASS_BAN_THRESHOLD = 3; // Max bans in time window
    private readonly MASS_KICK_THRESHOLD = 5; // Max kicks in time window
    private readonly MASS_CHANNEL_DELETE_THRESHOLD = 2; // Max channel deletions in time window
    private readonly MASS_ROLE_DELETE_THRESHOLD = 2; // Max role deletions in time window
    private readonly MASS_CHANNEL_CREATE_THRESHOLD = 5; // Max channel creations in time window
    private readonly MASS_ROLE_CREATE_THRESHOLD = 5; // Max role creations in time window
    private readonly TIME_WINDOW = 10 * 1000; // 10 seconds
    private readonly PERMISSION_ESCALATION_ROLES = [
        'Administrator',
        'Owner',
        'Co-Owner',
        'Platform Admin',
        'System Admin'
    ];

    private constructor() {}

    public static getInstance(): AntiNukeService {
        if (!AntiNukeService.instance) {
            AntiNukeService.instance = new AntiNukeService();
        }
        return AntiNukeService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
    }

    public async initialize() {
        if (this.isInitialized) return;
        
        // Clean up old data every 2 minutes
        setInterval(() => {
            this.cleanupOldData();
        }, 2 * 60 * 1000);

        this.isInitialized = true;
        console.log('[AntiNuke] Service initialized');
    }

    public async handleGuildBanAdd(ban: GuildBan): Promise<void> {
        try {
            const guild = ban.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Get audit log to find who banned
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanAdd,
                limit: 1
            });

            const banLog = auditLogs.entries.first();
            if (!banLog) return;

            const executor = banLog.executor;
            if (!executor || executor.id === this.client.user!.id) return; // Skip bot actions

            const actionEvent: ActionEvent = {
                executorId: executor.id,
                executorTag: executor.tag,
                action: 'ban',
                target: ban.user.id,
                timestamp: Date.now(),
                guildId: guild.id
            };

            this.recordActionEvent(guild.id, actionEvent);
            await this.checkForNuke(guild, 'ban');

        } catch (error) {
            console.error('[AntiNuke] Error handling guild ban add:', error);
            sentryService.captureException(error as Error, {
                context: 'antinuke_ban_add',
                guild_id: ban.guild.id,
                user_id: ban.user.id
            });
        }
    }

    public async handleGuildMemberRemove(member: GuildMember): Promise<void> {
        try {
            const guild = member.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Get audit log to find who kicked
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberKick,
                limit: 1
            });

            const kickLog = auditLogs.entries.first();
            if (!kickLog) return;

            const executor = kickLog.executor;
            if (!executor || executor.id === this.client.user!.id) return; // Skip bot actions

            const actionEvent: ActionEvent = {
                executorId: executor.id,
                executorTag: executor.tag,
                action: 'kick',
                target: member.user.id,
                timestamp: Date.now(),
                guildId: guild.id
            };

            this.recordActionEvent(guild.id, actionEvent);
            await this.checkForNuke(guild, 'kick');

        } catch (error) {
            console.error('[AntiNuke] Error handling guild member remove:', error);
            sentryService.captureException(error as Error, {
                context: 'antinuke_member_remove',
                guild_id: member.guild.id,
                user_id: member.user.id
            });
        }
    }

    public async handleChannelDelete(channel: Channel): Promise<void> {
        try {
            if (!channel.guild) return;
            
            const guild = channel.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Get audit log to find who deleted the channel
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelDelete,
                limit: 1
            });

            const deleteLog = auditLogs.entries.first();
            if (!deleteLog) return;

            const executor = deleteLog.executor;
            if (!executor || executor.id === this.client.user!.id) return; // Skip bot actions

            const actionEvent: ActionEvent = {
                executorId: executor.id,
                executorTag: executor.tag,
                action: 'channel_delete',
                target: channel.id,
                timestamp: Date.now(),
                guildId: guild.id
            };

            this.recordActionEvent(guild.id, actionEvent);
            await this.checkForNuke(guild, 'channel_delete');

        } catch (error) {
            console.error('[AntiNuke] Error handling channel delete:', error);
            sentryService.captureException(error as Error, {
                context: 'antinuke_channel_delete',
                guild_id: channel.guild?.id,
                channel_id: channel.id
            });
        }
    }

    public async handleChannelCreate(channel: Channel): Promise<void> {
        try {
            if (!channel.guild) return;
            
            const guild = channel.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Get audit log to find who created the channel
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelCreate,
                limit: 1
            });

            const createLog = auditLogs.entries.first();
            if (!createLog) return;

            const executor = createLog.executor;
            if (!executor || executor.id === this.client.user!.id) return; // Skip bot actions

            const actionEvent: ActionEvent = {
                executorId: executor.id,
                executorTag: executor.tag,
                action: 'channel_create',
                target: channel.id,
                timestamp: Date.now(),
                guildId: guild.id
            };

            this.recordActionEvent(guild.id, actionEvent);
            await this.checkForNuke(guild, 'channel_create');

        } catch (error) {
            console.error('[AntiNuke] Error handling channel create:', error);
            sentryService.captureException(error as Error, {
                context: 'antinuke_channel_create',
                guild_id: channel.guild?.id,
                channel_id: channel.id
            });
        }
    }

    public async handleRoleDelete(role: Role): Promise<void> {
        try {
            const guild = role.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Get audit log to find who deleted the role
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.RoleDelete,
                limit: 1
            });

            const deleteLog = auditLogs.entries.first();
            if (!deleteLog) return;

            const executor = deleteLog.executor;
            if (!executor || executor.id === this.client.user!.id) return; // Skip bot actions

            const actionEvent: ActionEvent = {
                executorId: executor.id,
                executorTag: executor.tag,
                action: 'role_delete',
                target: role.id,
                timestamp: Date.now(),
                guildId: guild.id
            };

            this.recordActionEvent(guild.id, actionEvent);
            await this.checkForNuke(guild, 'role_delete');

        } catch (error) {
            console.error('[AntiNuke] Error handling role delete:', error);
            sentryService.captureException(error as Error, {
                context: 'antinuke_role_delete',
                guild_id: role.guild.id,
                role_id: role.id
            });
        }
    }

    public async handleRoleCreate(role: Role): Promise<void> {
        try {
            const guild = role.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Get audit log to find who created the role
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.RoleCreate,
                limit: 1
            });

            const createLog = auditLogs.entries.first();
            if (!createLog) return;

            const executor = createLog.executor;
            if (!executor || executor.id === this.client.user!.id) return; // Skip bot actions

            const actionEvent: ActionEvent = {
                executorId: executor.id,
                executorTag: executor.tag,
                action: 'role_create',
                target: role.id,
                timestamp: Date.now(),
                guildId: guild.id
            };

            this.recordActionEvent(guild.id, actionEvent);
            await this.checkForNuke(guild, 'role_create');

        } catch (error) {
            console.error('[AntiNuke] Error handling role create:', error);
        }
    }

    public async handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
        try {
            const guild = newMember.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Check for permission escalation
            const oldRoles = oldMember.roles.cache;
            const newRoles = newMember.roles.cache;

            // Check if any dangerous roles were added
            const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
            const dangerousRoles = addedRoles.filter(role => 
                this.PERMISSION_ESCALATION_ROLES.some(dangerousRole => 
                    role.name.toLowerCase().includes(dangerousRole.toLowerCase())
                )
            );

            if (dangerousRoles.size > 0) {
                await this.handlePermissionEscalation(newMember, dangerousRoles);
            }

        } catch (error) {
            console.error('[AntiNuke] Error handling guild member update:', error);
        }
    }

    private recordActionEvent(guildId: string, event: ActionEvent): void {
        if (!this.actionEvents.has(guildId)) {
            this.actionEvents.set(guildId, []);
        }

        const events = this.actionEvents.get(guildId)!;
        events.push(event);

        // Remove old events outside the time window
        const cutoff = Date.now() - this.TIME_WINDOW;
        const filteredEvents = events.filter(e => e.timestamp > cutoff);
        this.actionEvents.set(guildId, filteredEvents);
    }

    private async checkForNuke(guild: any, actionType: string): Promise<void> {
        const events = this.actionEvents.get(guild.id) || [];
        const recentEvents = events.filter(e => 
            e.timestamp > Date.now() - this.TIME_WINDOW && 
            e.action === actionType
        );

        let threshold = 0;
        switch (actionType) {
            case 'ban':
                threshold = this.MASS_BAN_THRESHOLD;
                break;
            case 'kick':
                threshold = this.MASS_KICK_THRESHOLD;
                break;
            case 'channel_delete':
                threshold = this.MASS_CHANNEL_DELETE_THRESHOLD;
                break;
            case 'role_delete':
                threshold = this.MASS_ROLE_DELETE_THRESHOLD;
                break;
            case 'channel_create':
                threshold = this.MASS_CHANNEL_CREATE_THRESHOLD;
                break;
            case 'role_create':
                threshold = this.MASS_ROLE_CREATE_THRESHOLD;
                break;
        }

        if (recentEvents.length >= threshold) {
            // Group by executor
            const executorGroups = new Map<string, ActionEvent[]>();
            for (const event of recentEvents) {
                if (!executorGroups.has(event.executorId)) {
                    executorGroups.set(event.executorId, []);
                }
                executorGroups.get(event.executorId)!.push(event);
            }

            // Check each executor
            for (const [executorId, executorEvents] of executorGroups) {
                if (executorEvents.length >= threshold) {
                    const detection: NukeDetection = {
                        isNuke: true,
                        executorId,
                        executorTag: executorEvents[0].executorTag,
                        actionCount: executorEvents.length,
                        timeWindow: this.TIME_WINDOW,
                        actionType,
                        reason: `Mass ${actionType}: ${executorEvents.length} actions in ${this.TIME_WINDOW / 1000}s`
                    };

                    console.log(`[AntiNuke] Nuke detected: ${detection.reason} by ${detection.executorTag}`);
                    await this.handleNuke(guild, detection);
                }
            }
        }
    }

    private async handleNuke(guild: any, detection: NukeDetection): Promise<void> {
        try {
            // Get the executor member
            const executor = await guild.members.fetch(detection.executorId).catch(() => null);
            if (!executor) return;

            // Check if executor is staff (don't auto-ban staff, just alert)
            if (serverUtils.hasStaffRole(executor)) {
                await this.sendStaffNukeAlert(guild, detection, executor);
                return;
            }

            // Remove all roles from the executor
            await executor.roles.remove(executor.roles.cache.filter(role => role.name !== '@everyone'));

            // Ban the executor
            await guild.members.ban(executor, {
                reason: `Anti-nuke: ${detection.reason}`
            });

            // Create moderation action
            const moderationAction = await moderationService.createModerationAction({
                guildId: guild.id,
                userId: detection.executorId,
                moderatorId: this.client.user!.id,
                action: 'ban',
                reason: `Anti-nuke: ${detection.reason}`,
                duration: 0, // Permanent
                evidence: `Mass ${detection.actionType}: ${detection.actionCount} actions in ${detection.timeWindow / 1000} seconds`,
                appealable: true
            });

            // Send alert
            await this.sendNukeAlert(guild, detection, moderationAction.punishmentId);

            // Log the action
            await moderationService.sendModerationLog(
                moderationAction,
                executor.user,
                executor,
                { 
                    duration: 'Permanent',
                    evidence: `Mass ${detection.actionType}: ${detection.actionCount} actions in ${detection.timeWindow / 1000} seconds`
                }
            );

        } catch (error) {
            console.error('[AntiNuke] Error handling nuke:', error);
        }
    }

    private async handlePermissionEscalation(member: GuildMember, dangerousRoles: any): Promise<void> {
        try {
            // Check if member is staff (don't auto-remove roles from staff, just alert)
            if (serverUtils.hasStaffRole(member)) {
                await this.sendStaffPermissionEscalationAlert(member, dangerousRoles);
                return;
            }

            // Remove the dangerous roles
            await member.roles.remove(dangerousRoles);

            // Timeout the member
            await member.timeout(10 * 60 * 1000, 'Permission escalation detected');

            // Create moderation action
            const moderationAction = await moderationService.createModerationAction({
                guildId: member.guild.id,
                userId: member.user.id,
                moderatorId: this.client.user!.id,
                action: 'timeout',
                reason: 'Permission escalation detected by anti-nuke system',
                duration: 10 * 60 * 1000,
                evidence: `Attempted to gain dangerous roles: ${dangerousRoles.map(r => r.name).join(', ')}`,
                appealable: true
            });

            // Send alert
            await this.sendPermissionEscalationAlert(member, dangerousRoles, moderationAction.punishmentId);

            // Send DM to user
            await moderationService.sendModerationDM(
                moderationAction,
                member.user,
                member,
                '10 minutes'
            );

            // Log the action
            await moderationService.sendModerationLog(
                moderationAction,
                member.user,
                member,
                { 
                    duration: '10 minutes',
                    evidence: `Attempted to gain dangerous roles: ${dangerousRoles.map(r => r.name).join(', ')}`
                }
            );

        } catch (error) {
            console.error('[AntiNuke] Error handling permission escalation:', error);
        }
    }

    private async sendNukeAlert(guild: any, detection: NukeDetection, punishmentId: string): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('🚨 NUKE ATTEMPT DETECTED')
                .setDescription('The anti-nuke system has detected and prevented a potential server nuke.')
                .addFields(
                    { name: '👤 Executor', value: `${detection.executorTag} (<@${detection.executorId}>)`, inline: true },
                    { name: '🔧 Action Type', value: detection.actionType, inline: true },
                    { name: '📊 Action Count', value: detection.actionCount.toString(), inline: true },
                    { name: '⏰ Time Window', value: `${detection.timeWindow / 1000}s`, inline: true },
                    { name: '🔍 Reason', value: detection.reason, inline: false },
                    { name: '🛡️ Action Taken', value: 'Executor banned and roles removed', inline: false },
                    { name: '🆔 Punishment ID', value: punishmentId, inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(guild, embed);
        } catch (error) {
            console.error('[AntiNuke] Error sending nuke alert:', error);
        }
    }

    private async sendStaffNukeAlert(guild: any, detection: NukeDetection, executor: GuildMember): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('⚠️ STAFF NUKE ATTEMPT DETECTED')
                .setDescription('A staff member has triggered the anti-nuke system.')
                .addFields(
                    { name: '👤 Staff Member', value: `${detection.executorTag} (<@${detection.executorId}>)`, inline: true },
                    { name: '🔧 Action Type', value: detection.actionType, inline: true },
                    { name: '📊 Action Count', value: detection.actionCount.toString(), inline: true },
                    { name: '⏰ Time Window', value: `${detection.timeWindow / 1000}s`, inline: true },
                    { name: '🔍 Reason', value: detection.reason, inline: false },
                    { name: '🛡️ Action Taken', value: 'Alert sent (no auto-ban for staff)', inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(guild, embed);
        } catch (error) {
            console.error('[AntiNuke] Error sending staff nuke alert:', error);
        }
    }

    private async sendPermissionEscalationAlert(member: GuildMember, dangerousRoles: any, punishmentId: string): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('🚨 PERMISSION ESCALATION DETECTED')
                .setDescription('A user attempted to gain dangerous permissions.')
                .addFields(
                    { name: '👤 User', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
                    { name: '🔧 Attempted Roles', value: dangerousRoles.map(r => r.name).join(', '), inline: false },
                    { name: '🛡️ Action Taken', value: 'Roles removed and user timed out', inline: false },
                    { name: '🆔 Punishment ID', value: punishmentId, inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(member.guild, embed);
        } catch (error) {
            console.error('[AntiNuke] Error sending permission escalation alert:', error);
        }
    }

    private async sendStaffPermissionEscalationAlert(member: GuildMember, dangerousRoles: any): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('⚠️ STAFF PERMISSION ESCALATION')
                .setDescription('A staff member gained dangerous permissions.')
                .addFields(
                    { name: '👤 Staff Member', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
                    { name: '🔧 Gained Roles', value: dangerousRoles.map(r => r.name).join(', '), inline: false },
                    { name: '🛡️ Action Taken', value: 'Alert sent (no auto-action for staff)', inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(member.guild, embed);
        } catch (error) {
            console.error('[AntiNuke] Error sending staff permission escalation alert:', error);
        }
    }

    private async sendAlertToStaff(guild: any, embed: EmbedBuilder): Promise<void> {
        try {
            // Send to punishment logs channel
            const logsChannel = await this.client.channels.fetch(config.punishmentLogsChannelId).catch(() => null);
            if (logsChannel && logsChannel.isTextBased() && 'send' in logsChannel) {
                await (logsChannel as any).send({ embeds: [embed] });
            } else {
                console.error('[AntiNuke] Could not find punishment logs channel');
            }
        } catch (error) {
            console.error('[AntiNuke] Error sending alert to logs channel:', error);
        }
    }

    private cleanupOldData(): void {
        const now = Date.now();
        
        // Clean up old action events
        for (const [guildId, events] of this.actionEvents.entries()) {
            const cutoff = now - this.TIME_WINDOW;
            const filteredEvents = events.filter(e => e.timestamp > cutoff);
            this.actionEvents.set(guildId, filteredEvents);
        }
    }

    public getStatus(guildId: string): {
        recentBans: number;
        recentKicks: number;
        recentChannelDeletions: number;
        recentRoleDeletions: number;
        recentChannelCreations: number;
        recentRoleCreations: number;
    } {
        const events = this.actionEvents.get(guildId) || [];
        const recentEvents = events.filter(e => e.timestamp > Date.now() - this.TIME_WINDOW);

        return {
            recentBans: recentEvents.filter(e => e.action === 'ban').length,
            recentKicks: recentEvents.filter(e => e.action === 'kick').length,
            recentChannelDeletions: recentEvents.filter(e => e.action === 'channel_delete').length,
            recentRoleDeletions: recentEvents.filter(e => e.action === 'role_delete').length,
            recentChannelCreations: recentEvents.filter(e => e.action === 'channel_create').length,
            recentRoleCreations: recentEvents.filter(e => e.action === 'role_create').length
        };
    }

    public stop(): void {
        this.actionEvents.clear();
        this.isInitialized = false;
    }
}

export const antiNukeService = AntiNukeService.getInstance(); 