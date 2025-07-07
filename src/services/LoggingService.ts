import { 
    Client, 
    TextChannel, 
    EmbedBuilder, 
    Message, 
    GuildMember, 
    Role, 
    AuditLogEvent,
    Channel,
    User,
    GuildBan,
    GuildAuditLogsEntry,
    PartialGuildMember,
    PartialMessage,
    Collection,
    Guild,
    PermissionFlagsBits
} from 'discord.js';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';

interface LoggingConfig {
    enabled: boolean;
    messageEdits: boolean;
    messageDeletes: boolean;
    memberJoins: boolean;
    memberLeaves: boolean;
    roleUpdates: boolean;
    channelUpdates: boolean;
    serverUpdates: boolean;
    memberUpdates: boolean;
    banEvents: boolean;
    inviteTracking: boolean;
}

export class LoggingService {
    private static instance: LoggingService;
    private client!: Client;
    private messageCache = new Map<string, Message>();
    private config: LoggingConfig = {
        enabled: true,
        messageEdits: true,
        messageDeletes: true,
        memberJoins: true,
        memberLeaves: true,
        roleUpdates: true,
        channelUpdates: true,
        serverUpdates: true,
        memberUpdates: true,
        banEvents: true,
        inviteTracking: true
    };

    private constructor() {}

    public static getInstance(): LoggingService {
        if (!LoggingService.instance) {
            LoggingService.instance = new LoggingService();
        }
        return LoggingService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        console.log('[LoggingService] Setting up event listeners...');
        
        // Message events
        this.client.on('messageCreate', this.handleMessageCreate.bind(this));
        this.client.on('messageUpdate', this.handleMessageEdit.bind(this));
        this.client.on('messageDelete', this.handleMessageDelete.bind(this));

        // Member events
        this.client.on('guildMemberAdd', this.handleMemberJoin.bind(this));
        this.client.on('guildMemberRemove', this.handleMemberLeave.bind(this));
        this.client.on('guildMemberUpdate', this.handleMemberUpdate.bind(this));

        // Role events
        this.client.on('roleCreate', this.handleRoleCreate.bind(this));
        this.client.on('roleDelete', this.handleRoleDelete.bind(this));
        this.client.on('roleUpdate', this.handleRoleUpdate.bind(this));

        // Channel events
        this.client.on('channelCreate', this.handleChannelCreate.bind(this));
        this.client.on('channelDelete', this.handleChannelDelete.bind(this));
        this.client.on('channelUpdate', this.handleChannelUpdate.bind(this));

        // Server events
        this.client.on('guildUpdate', this.handleServerUpdate.bind(this));

        // Ban events
        this.client.on('guildBanAdd', this.handleMemberBan.bind(this));
        this.client.on('guildBanRemove', this.handleMemberUnban.bind(this));
    }

    private async getLogChannel(guild: Guild): Promise<TextChannel | null> {
        try {
            // Try to find a logs channel
            const logsChannel = guild.channels.cache.find(
                channel => channel.name.toLowerCase().includes('logs') && 
                          channel.type === 0 // TextChannel
            ) as TextChannel;

            if (logsChannel) {
                return logsChannel;
            }

            // Fallback to punishment logs channel
            const punishmentChannel = await this.client.channels.fetch(config.punishmentLogsChannelId);
            if (punishmentChannel instanceof TextChannel) {
                return punishmentChannel;
            }

            return null;
        } catch (error) {
            console.error('[LoggingService] Error getting log channel:', error);
            return null;
        }
    }

    private async findAuditLogExecutor(guild: Guild, targetId: string, actionType: AuditLogEvent): Promise<User | null> {
        try {
            const auditLogs = await guild.fetchAuditLogs({
                type: actionType,
                limit: 1
            });

            const entry = auditLogs.entries.first();
            if (entry && entry.target?.id === targetId) {
                return entry.executor;
            }

            return null;
        } catch (error) {
            console.error('[LoggingService] Error fetching audit logs:', error);
            return null;
        }
    }

    // Message Events
    private async handleMessageCreate(message: Message) {
        if (!this.config.enabled || message.author.bot || !message.guild) return;
        
        // Cache the message for edit tracking
        this.messageCache.set(message.id, message);
        
        // Clean up old messages from cache (keep last 1000)
        if (this.messageCache.size > 1000) {
            const firstKey = this.messageCache.keys().next().value;
            this.messageCache.delete(firstKey);
        }
    }

    private async handleMessageEdit(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
        if (!this.config.messageEdits || !this.config.enabled || !newMessage.guild || newMessage.author?.bot) return;

        try {
            const logChannel = await this.getLogChannel(newMessage.guild);
            if (!logChannel) return;

            const oldContent = oldMessage.content || 'No content';
            const newContent = newMessage.content || 'No content';

            // Don't log if content is the same (embeds, attachments, etc.)
            if (oldContent === newContent) return;

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('✏️ Message Edited')
                .setDescription(`A message was edited in ${newMessage.channel}`)
                .addFields(
                    { name: '👤 Author', value: `${newMessage.author?.tag} (<@${newMessage.author?.id}>)`, inline: true },
                    { name: '📝 Channel', value: `${newMessage.channel}`, inline: true },
                    { name: '🔗 Message', value: `[Jump to Message](${newMessage.url})`, inline: true },
                    { name: '📄 Before', value: oldContent.length > 1024 ? oldContent.substring(0, 1021) + '...' : oldContent, inline: false },
                    { name: '📄 After', value: newContent.length > 1024 ? newContent.substring(0, 1021) + '...' : newContent, inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging message edit:', error);
        }
    }

    private async handleMessageDelete(message: Message | PartialMessage) {
        if (!this.config.messageDeletes || !this.config.enabled || !message.guild || message.author?.bot) return;

        try {
            const logChannel = await this.getLogChannel(message.guild);
            if (!logChannel) return;

            const executor = await this.findAuditLogExecutor(message.guild, message.author?.id || '', AuditLogEvent.MemberKick);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('🗑️ Message Deleted')
                .setDescription(`A message was deleted in ${message.channel}`)
                .addFields(
                    { name: '👤 Author', value: `${message.author?.tag} (<@${message.author?.id}>)`, inline: true },
                    { name: '📝 Channel', value: `${message.channel}`, inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (message.content) {
                embed.addFields({ name: '📄 Content', value: message.content.length > 1024 ? message.content.substring(0, 1021) + '...' : message.content, inline: false });
            }

            if (executor) {
                embed.addFields({ name: '🛡️ Deleted by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging message delete:', error);
        }
    }

    // Member Events
    private async handleMemberJoin(member: GuildMember) {
        if (!this.config.memberJoins || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(member.guild);
            if (!logChannel) return;

            // Only log to admin channel, don't send welcome message
            // Welcome messages are handled by the dedicated WelcomeService
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('📊 Member Joined (Log)')
                .setDescription(`${member.user.tag} has joined the server`)
                .addFields(
                    { name: '👤 User', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
                    { name: '🆔 User ID', value: member.user.id, inline: true },
                    { name: '📅 Account Created', value: `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:R>`, inline: true },
                    { name: '👥 Member Count', value: `${member.guild.memberCount}`, inline: true }
                )
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging member join:', error);
        }
    }

    private async handleMemberLeave(member: GuildMember | PartialGuildMember) {
        console.log('[LoggingService] Member leave event triggered:', member.user?.tag);
        
        if (!this.config.memberLeaves || !this.config.enabled) {
            console.log('[LoggingService] Member leave logging disabled or service disabled');
            return;
        }

        try {
            const logChannel = await this.getLogChannel(member.guild);
            if (!logChannel) {
                console.log('[LoggingService] No log channel found for member leave');
                return;
            }

            // Check if this was a kick by looking at audit logs
            const executor = await this.findAuditLogExecutor(member.guild, member.user?.id || '', AuditLogEvent.MemberKick);
            
            let title = '👋 Member Left';
            let description = `${member.user?.tag} has left the server`;
            let color = serverUtils.getColor('error');

            if (executor) {
                title = '👢 Member Kicked';
                description = `${member.user?.tag} was kicked from the server`;
                color = serverUtils.getColor('warning');
            }

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(title)
                .setDescription(description)
                .addFields(
                    { name: '👤 User', value: `${member.user?.tag} (<@${member.user?.id}>)`, inline: true },
                    { name: '🆔 User ID', value: member.user?.id || 'Unknown', inline: true },
                    { name: '👥 Member Count', value: `${member.guild.memberCount}`, inline: true }
                )
                .setThumbnail(member.user?.displayAvatarURL())
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Kicked by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
            console.log('[LoggingService] Successfully logged member leave/kick to channel:', logChannel.name);
        } catch (error) {
            console.error('[LoggingService] Error logging member leave:', error);
        }
    }

    private async handleMemberUpdate(oldMember: GuildMember, newMember: GuildMember) {
        if (!this.config.memberUpdates || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(newMember.guild);
            if (!logChannel) return;

            // Check for nickname changes
            if (oldMember.nickname !== newMember.nickname) {
                const embed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('info'))
                    .setTitle('📝 Nickname Changed')
                    .setDescription(`${newMember.user.tag} changed their nickname`)
                    .addFields(
                        { name: '👤 User', value: `${newMember.user.tag} (<@${newMember.user.id}>)`, inline: true },
                        { name: '📝 Old Nickname', value: oldMember.nickname || 'None', inline: true },
                        { name: '📝 New Nickname', value: newMember.nickname || 'None', inline: true }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await logChannel.send({ embeds: [embed] });
            }

            // Check for role changes
            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

            if (addedRoles.size > 0 || removedRoles.size > 0) {
                const embed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('info'))
                    .setTitle('🎭 Roles Updated')
                    .setDescription(`Roles were updated for ${newMember.user.tag}`)
                    .addFields(
                        { name: '👤 User', value: `${newMember.user.tag} (<@${newMember.user.id}>)`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                if (addedRoles.size > 0) {
                    embed.addFields({ name: '➕ Added Roles', value: addedRoles.map(role => role.name).join(', '), inline: false });
                }

                if (removedRoles.size > 0) {
                    embed.addFields({ name: '➖ Removed Roles', value: removedRoles.map(role => role.name).join(', '), inline: false });
                }

                await logChannel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('[LoggingService] Error logging member update:', error);
        }
    }

    // Role Events
    private async handleRoleCreate(role: Role) {
        if (!this.config.roleUpdates || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(role.guild);
            if (!logChannel) return;

            const executor = await this.findAuditLogExecutor(role.guild, role.id, AuditLogEvent.RoleCreate);

            const embed = new EmbedBuilder()
                .setColor(role.color || serverUtils.getColor('success'))
                .setTitle('🎭 Role Created')
                .setDescription(`A new role was created: ${role.name}`)
                .addFields(
                    { name: '🎭 Role', value: `${role.name} (<@&${role.id}>)`, inline: true },
                    { name: '🆔 Role ID', value: role.id, inline: true },
                    { name: '🎨 Color', value: role.hexColor, inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Created by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging role create:', error);
        }
    }

    private async handleRoleDelete(role: Role) {
        if (!this.config.roleUpdates || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(role.guild);
            if (!logChannel) return;

            const executor = await this.findAuditLogExecutor(role.guild, role.id, AuditLogEvent.RoleDelete);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('🎭 Role Deleted')
                .setDescription(`A role was deleted: ${role.name}`)
                .addFields(
                    { name: '🎭 Role', value: role.name, inline: true },
                    { name: '🆔 Role ID', value: role.id, inline: true },
                    { name: '🎨 Color', value: role.hexColor, inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Deleted by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging role delete:', error);
        }
    }

    private async handleRoleUpdate(oldRole: Role, newRole: Role) {
        if (!this.config.roleUpdates || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(newRole.guild);
            if (!logChannel) return;

            const changes: string[] = [];

            if (oldRole.name !== newRole.name) {
                changes.push(`Name: ${oldRole.name} → ${newRole.name}`);
            }

            if (oldRole.color !== newRole.color) {
                changes.push(`Color: ${oldRole.hexColor} → ${newRole.hexColor}`);
            }

            if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
                changes.push('Permissions were modified');
            }

            if (changes.length === 0) return;

            const executor = await this.findAuditLogExecutor(newRole.guild, newRole.id, AuditLogEvent.RoleUpdate);

            const embed = new EmbedBuilder()
                .setColor(newRole.color || serverUtils.getColor('info'))
                .setTitle('🎭 Role Updated')
                .setDescription(`Role ${newRole.name} was updated`)
                .addFields(
                    { name: '🎭 Role', value: `${newRole.name} (<@&${newRole.id}>)`, inline: true },
                    { name: '📝 Changes', value: changes.join('\n'), inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Updated by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging role update:', error);
        }
    }

    // Channel Events
    private async handleChannelCreate(channel: Channel) {
        if (!this.config.channelUpdates || !this.config.enabled || !channel.guild) return;

        try {
            const logChannel = await this.getLogChannel(channel.guild);
            if (!logChannel) return;

            const executor = await this.findAuditLogExecutor(channel.guild, channel.id, AuditLogEvent.ChannelCreate);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('success'))
                .setTitle('📝 Channel Created')
                .setDescription(`A new channel was created: ${channel.name}`)
                .addFields(
                    { name: '📝 Channel', value: `${channel.name} (<#${channel.id}>)`, inline: true },
                    { name: '🆔 Channel ID', value: channel.id, inline: true },
                    { name: '📂 Type', value: channel.type.toString(), inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Created by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging channel create:', error);
        }
    }

    private async handleChannelDelete(channel: Channel) {
        if (!this.config.channelUpdates || !this.config.enabled || !channel.guild) return;

        try {
            const logChannel = await this.getLogChannel(channel.guild);
            if (!logChannel) return;

            const executor = await this.findAuditLogExecutor(channel.guild, channel.id, AuditLogEvent.ChannelDelete);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('📝 Channel Deleted')
                .setDescription(`A channel was deleted: ${channel.name}`)
                .addFields(
                    { name: '📝 Channel', value: channel.name, inline: true },
                    { name: '🆔 Channel ID', value: channel.id, inline: true },
                    { name: '📂 Type', value: channel.type.toString(), inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Deleted by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging channel delete:', error);
        }
    }

    private async handleChannelUpdate(oldChannel: Channel, newChannel: Channel) {
        if (!this.config.channelUpdates || !this.config.enabled || !newChannel.guild) return;

        try {
            const logChannel = await this.getLogChannel(newChannel.guild);
            if (!logChannel) return;

            const changes: string[] = [];

            if (oldChannel.name !== newChannel.name) {
                changes.push(`Name: ${oldChannel.name} → ${newChannel.name}`);
            }

            if (changes.length === 0) return;

            const executor = await this.findAuditLogExecutor(newChannel.guild, newChannel.id, AuditLogEvent.ChannelUpdate);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('📝 Channel Updated')
                .setDescription(`Channel ${newChannel.name} was updated`)
                .addFields(
                    { name: '📝 Channel', value: `${newChannel.name} (<#${newChannel.id}>)`, inline: true },
                    { name: '📝 Changes', value: changes.join('\n'), inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Updated by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging channel update:', error);
        }
    }

    // Server Events
    private async handleServerUpdate(oldGuild: Guild, newGuild: Guild) {
        if (!this.config.serverUpdates || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(newGuild);
            if (!logChannel) return;

            const changes: string[] = [];

            if (oldGuild.name !== newGuild.name) {
                changes.push(`Name: ${oldGuild.name} → ${newGuild.name}`);
            }

            if (oldGuild.icon !== newGuild.icon) {
                changes.push('Icon was changed');
            }

            if (oldGuild.banner !== newGuild.banner) {
                changes.push('Banner was changed');
            }

            if (changes.length === 0) return;

            const executor = await this.findAuditLogExecutor(newGuild, newGuild.id, AuditLogEvent.GuildUpdate);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('🏠 Server Updated')
                .setDescription(`Server settings were updated`)
                .addFields(
                    { name: '📝 Changes', value: changes.join('\n'), inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Updated by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging server update:', error);
        }
    }

    // Ban Events
    private async handleMemberBan(ban: GuildBan) {
        if (!this.config.banEvents || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(ban.guild);
            if (!logChannel) return;

            const executor = await this.findAuditLogExecutor(ban.guild, ban.user.id, AuditLogEvent.MemberBan);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('🔨 Member Banned')
                .setDescription(`${ban.user.tag} was banned from the server`)
                .addFields(
                    { name: '👤 User', value: `${ban.user.tag} (<@${ban.user.id}>)`, inline: true },
                    { name: '🆔 User ID', value: ban.user.id, inline: true }
                )
                .setThumbnail(ban.user.displayAvatarURL())
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (ban.reason) {
                embed.addFields({ name: '📝 Reason', value: ban.reason, inline: false });
            }

            if (executor) {
                embed.addFields({ name: '🛡️ Banned by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging member ban:', error);
        }
    }

    private async handleMemberUnban(ban: GuildBan) {
        if (!this.config.banEvents || !this.config.enabled) return;

        try {
            const logChannel = await this.getLogChannel(ban.guild);
            if (!logChannel) return;

            const executor = await this.findAuditLogExecutor(ban.guild, ban.user.id, AuditLogEvent.MemberUnban);

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('success'))
                .setTitle('🔓 Member Unbanned')
                .setDescription(`${ban.user.tag} was unbanned from the server`)
                .addFields(
                    { name: '👤 User', value: `${ban.user.tag} (<@${ban.user.id}>)`, inline: true },
                    { name: '🆔 User ID', value: ban.user.id, inline: true }
                )
                .setThumbnail(ban.user.displayAvatarURL())
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            if (executor) {
                embed.addFields({ name: '🛡️ Unbanned by', value: `${executor.tag} (<@${executor.id}>)`, inline: true });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('[LoggingService] Error logging member unban:', error);
        }
    }

    public setConfig(newConfig: Partial<LoggingConfig>) {
        this.config = { ...this.config, ...newConfig };
    }

    public getConfig(): LoggingConfig {
        return { ...this.config };
    }
}

export const loggingService = LoggingService.getInstance();
