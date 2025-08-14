import { 
    Message, 
    TextChannel, 
    EmbedBuilder,
    GuildMember,
    User
} from 'discord.js';
import { serverUtils, ServerType } from '../utils/ServerUtils';
import { config } from '../config/config';
import { sentryService } from './SentryService';

interface PingProtectionConfig {
    enabled: boolean;
    protectedRoles: string[];
    warningMessage: string;
    deleteMessages: boolean;
    logViolations: boolean;
    whitelistedChannels: string[];
    whitelistedUsers: string[];
}

export class PingProtectionService {
    private static instance: PingProtectionService;
    private client: any;
    private config: PingProtectionConfig;
    private isInitialized = false;

    private constructor() {
        this.config = {
            enabled: true,
            protectedRoles: [], // Will be populated from ServerUtils
            warningMessage: "⚠️ **Please do not ping administrators or managers.**\n\nIf you need assistance, please:\n• Create a ticket\n• Wait for staff to respond\n\n**Repeated pinging may result in moderation action.**",
            deleteMessages: true,
            logViolations: true,
            whitelistedChannels: [],
            whitelistedUsers: []
        };
    }

    public static getInstance(): PingProtectionService {
        if (!PingProtectionService.instance) {
            PingProtectionService.instance = new PingProtectionService();
        }
        return PingProtectionService.instance;
    }

    public setClient(client: any) {
        this.client = client;
    }

    public async initialize() {
        if (this.isInitialized) return;
        
        // Set up message listener
        this.client.on('messageCreate', async (message: Message) => {
            await this.handleMessage(message);
        });

        this.isInitialized = true;
        console.log('[PingProtectionService] Initialized');
    }

    private async handleMessage(message: Message) {
        console.log(`[PingProtectionService] Checking message from ${message.author.tag}: "${message.content}"`);
        
        // Ignore bot messages
        if (message.author.bot) {
            return;
        }

        // Ignore DMs
        //  lol
        if (!message.guild) {
            return;
        }

        // Set server type
        const serverType = serverUtils.getServerTypeFromGuildId(message.guild.id);
        serverUtils.setServerType(serverType);

        // Check if protection is enabled
        if (!this.config.enabled) {
            return;
        }

        // Check if channel is whitelisted
        if (this.config.whitelistedChannels.includes(message.channel.id)) {
            return;
        }

        // Check if user is whitelisted
        if (this.config.whitelistedUsers.includes(message.author.id)) {
            return;
        }

        // For HolyPvP, allow replies
        if (serverType === ServerType.HOLYPVP && message.type === 19) { 
            return;
        }

        // Check if user has admin/manager role (they can ping each other)
        if (message.member) {
            const hasAdminRole = serverUtils.hasAdminRole(message.member);
            const hasManagerRole = serverUtils.hasManagerRole(message.member);
            
            if (hasAdminRole || hasManagerRole) {
                return;
            }
        }

        // Check for pings of protected roles
        const violations = this.checkPings(message, serverType);
        console.log(`[PingProtectionService] Found ${violations.length} ping violations:`, violations);
        
        if (violations.length > 0) {
            console.log(`[PingProtectionService] Handling ping violation for message: "${message.content}"`);
            await this.handleViolation(message, violations);
        }
    }

    private checkPings(message: Message, serverType: ServerType): { user: User; role: string }[] {
        const violations: { user: User; role: string }[] = [];
        
        // Get protected roles from ServerUtils
        let protectedRoles: string[];
        
        if (serverType === ServerType.HOLYPVP) {
            // For HolyPvP, only protect Admin roles and Manager roles
            const adminRoles = serverUtils.getRoles().admin;
            const managerRoles = serverUtils.getRoles().manager;
            protectedRoles = [...adminRoles, ...managerRoles];
        } else {
            // For Scala, protect both Admin and Manager roles
            const adminRoles = serverUtils.getRoles().admin;
            const managerRoles = serverUtils.getRoles().manager;
            protectedRoles = [...adminRoles, ...managerRoles];
        }

        // Check each mentioned user
        for (const mentionedUser of message.mentions.users.values()) {
            try {
                const member = message.guild!.members.cache.get(mentionedUser.id);
                if (member) {
                    // Check if the mentioned user has any protected roles
                    for (const role of member.roles.cache.values()) {
                        if (protectedRoles.includes(role.name)) {
                            violations.push({ user: mentionedUser, role: role.name });
                            break; // Only count each user once
                        }
                    }
                }
            } catch (error) {
                console.error(`[PingProtectionService] Error checking user ${mentionedUser.id}:`, error);
            }
        }

        return violations;
    }

    private async handleViolation(message: Message, violations: { user: User; role: string }[]) {
        try {
            // Delete the message if enabled
            if (this.config.deleteMessages) {
                await message.delete();
                console.log(`[PingProtectionService] Deleted message from ${message.author.tag}`);
            }

            // Create warning embed
            const warningEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('⚠️ Ping Protection')
                .setDescription(this.config.warningMessage)
                .addFields(
                    { 
                        name: '🚫 Pinged Users', 
                        value: violations.map(v => `${v.user.tag} (${v.role})`).join('\n'), 
                        inline: false 
                    },
                    { 
                        name: '👤 Message Author', 
                        value: `${message.author.tag} (<@${message.author.id}>)`, 
                        inline: true 
                    },
                    { 
                        name: '📝 Channel', 
                        value: `${message.channel} (<#${message.channel.id}>)`, 
                        inline: true 
                    }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            // Send warning to the channel
            if (message.channel.isTextBased() && message.channel instanceof TextChannel) {
                await message.channel.send({
                    content: `${message.author}`,
                    embeds: [warningEmbed]
                });
            }

            // Try to send DM to the user
            try {
                const dmEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('warning'))
                    .setTitle('⚠️ Ping Protection Warning')
                    .setDescription(this.config.warningMessage)
                    .addFields(
                        { 
                            name: '🚫 Pinged Users', 
                            value: violations.map(v => `${v.user.tag} (${v.role})`).join('\n'), 
                            inline: false 
                        },
                        { 
                            name: '📝 Channel', 
                            value: `${message.channel} (<#${message.channel.id}>)`, 
                            inline: true 
                        }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await message.author.send({ embeds: [dmEmbed] });
                console.log(`[PingProtectionService] Sent DM warning to ${message.author.tag}`);
            } catch (dmError) {
                console.log(`[PingProtectionService] Could not send DM to ${message.author.tag}:`, dmError);
            }

            // Log violation if enabled
            if (this.config.logViolations) {
                await this.logViolation(message, violations);
            }

        } catch (error) {
            console.error('[PingProtectionService] Error handling violation:', error);
            sentryService.captureException(error as Error, {
                context: 'ping_protection_violation',
                guild_id: message.guild?.id,
                user_id: message.author.id,
                channel_id: message.channel.id
            });
        }
    }

    private async logViolation(message: Message, violations: { user: User; role: string }[]) {
        try {
            // Try to find a logging channel
            const loggingChannel = await this.findLoggingChannel(message.guild!);
            
            if (loggingChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('warning'))
                    .setTitle('🚫 Ping Protection Violation')
                    .setDescription(`User pinged protected role members`)
                    .addFields(
                        { name: '👤 User', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                        { name: '📝 Channel', value: `${message.channel} (<#${message.channel.id}>)`, inline: true },
                        { name: '🚫 Pinged Users', value: violations.map(v => `${v.user.tag} (${v.role})`).join('\n'), inline: false },
                        { name: '📄 Original Message', value: message.content.length > 1024 ? message.content.substring(0, 1021) + '...' : message.content, inline: false }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await loggingChannel.send({ embeds: [logEmbed] });
                console.log(`[PingProtectionService] Logged violation to ${loggingChannel.name}`);
            }
        } catch (error) {
            console.error('[PingProtectionService] Error logging violation:', error);
            sentryService.captureException(error as Error, {
                context: 'ping_protection_log',
                guild_id: message.guild?.id,
                user_id: message.author.id,
                channel_id: message.channel.id
            });
        }
    }

    private async findLoggingChannel(guild: any): Promise<TextChannel | null> {
        try {
            // Primary: Use configured punishment logs channel
            const punishmentChannel = await this.client.channels.fetch(config.punishmentLogsChannelId);
            if (punishmentChannel instanceof TextChannel) {
                return punishmentChannel;
            }

            // Fallback: Try to find a channel with "log" or "mod" in the name
            const logChannels = guild.channels.cache.filter((channel: any) => 
                channel.type === 0 && // Text channel
                (channel.name.toLowerCase().includes('log') || 
                 channel.name.toLowerCase().includes('mod') ||
                 channel.name.toLowerCase().includes('admin'))
            );

            if (logChannels.size > 0) {
                return logChannels.first();
            }

            // Final fallback to system channel
            if (guild.systemChannel) {
                return guild.systemChannel;
            }

            return null;
        } catch (error) {
            console.error('[PingProtectionService] Error getting log channel:', error);
            sentryService.captureException(error as Error, {
                context: 'ping_protection_get_channel',
                guild_id: guild.id
            });
            return null;
        }
    }

    // Configuration methods
    public setEnabled(enabled: boolean) {
        this.config.enabled = enabled;
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    public setDeleteMessages(deleteMessages: boolean) {
        this.config.deleteMessages = deleteMessages;
    }

    public getDeleteMessages(): boolean {
        return this.config.deleteMessages;
    }

    public setWarningMessage(message: string) {
        this.config.warningMessage = message;
    }

    public getWarningMessage(): string {
        return this.config.warningMessage;
    }

    public addWhitelistedChannel(channelId: string) {
        if (!this.config.whitelistedChannels.includes(channelId)) {
            this.config.whitelistedChannels.push(channelId);
        }
    }

    public removeWhitelistedChannel(channelId: string) {
        const index = this.config.whitelistedChannels.indexOf(channelId);
        if (index > -1) {
            this.config.whitelistedChannels.splice(index, 1);
        }
    }

    public getWhitelistedChannels(): string[] {
        return [...this.config.whitelistedChannels];
    }

    public addWhitelistedUser(userId: string) {
        if (!this.config.whitelistedUsers.includes(userId)) {
            this.config.whitelistedUsers.push(userId);
        }
    }

    public removeWhitelistedUser(userId: string) {
        const index = this.config.whitelistedUsers.indexOf(userId);
        if (index > -1) {
            this.config.whitelistedUsers.splice(index, 1);
        }
    }

    public getWhitelistedUsers(): string[] {
        return [...this.config.whitelistedUsers];
    }

    public getConfig(): PingProtectionConfig {
        return { ...this.config };
    }
}

export const pingProtectionService = PingProtectionService.getInstance(); 