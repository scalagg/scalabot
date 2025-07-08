import { 
    Client, 
    Message, 
    TextChannel, 
    EmbedBuilder,
    PermissionFlagsBits,
    GuildMember
} from 'discord.js';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';

interface MessageEvent {
    userId: string;
    username: string;
    timestamp: number;
    channelId: string;
    guildId: string;
}

interface CooldownStatus {
    isActive: boolean;
    enabledAt: number;
    duration: number;
    reason: string;
    messageCount: number;
    threshold: number;
}

export class AutoCooldownService {
    private static instance: AutoCooldownService;
    private client!: Client;
    private messageEvents: Map<string, MessageEvent[]> = new Map(); // guildId -> events
    private cooldownStatus: Map<string, CooldownStatus> = new Map(); // guildId -> status
    private isInitialized = false;

    // Configuration
    private readonly SPAM_THRESHOLD = 8; // Messages in time window to trigger cooldown
    private readonly TIME_WINDOW = 10 * 1000; // 10 seconds
    private readonly COOLDOWN_DURATION = 5 * 60 * 1000; // 5 minutes
    private readonly AUTO_DISABLE_DELAY = 10 * 60 * 1000; // 10 minutes (auto-disable cooldown)
    private readonly WHITELISTED_ROLES = [
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
    ];

    private constructor() {}

    public static getInstance(): AutoCooldownService {
        if (!AutoCooldownService.instance) {
            AutoCooldownService.instance = new AutoCooldownService();
        }
        return AutoCooldownService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
    }

    public async initialize() {
        if (this.isInitialized) return;
        
        // Clean up old data every minute
        setInterval(() => {
            this.cleanupOldData();
        }, 60 * 1000);

        // Auto-disable cooldowns after delay
        setInterval(() => {
            this.checkAutoDisable();
        }, 30 * 1000);

        this.isInitialized = true;
        console.log('[AutoCooldown] Service initialized');
    }

    public async handleMessage(message: Message): Promise<void> {
        try {
            // Skip bot messages and DMs
            if (message.author.bot || !message.guild) {
                return;
            }

            // Skip if user has whitelisted role
            if (message.member && this.hasWhitelistedRole(message.member)) {
                return;
            }

            const guild = message.guild;
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(guild.id));

            // Record message event
            const messageEvent: MessageEvent = {
                userId: message.author.id,
                username: message.author.tag,
                timestamp: Date.now(),
                channelId: message.channel.id,
                guildId: guild.id
            };

            this.recordMessageEvent(guild.id, messageEvent);

            // Check for spam
            const spamDetection = this.detectSpam(guild.id);
            if (spamDetection.isSpam && !this.isCooldownActive(guild.id)) {
                await this.handleSpam(guild, spamDetection);
            }

            // If cooldown is active, check if message should be deleted
            if (this.isCooldownActive(guild.id)) {
                await this.handleCooldownViolation(message);
            }

        } catch (error) {
            console.error('[AutoCooldown] Error handling message:', error);
        }
    }

    private recordMessageEvent(guildId: string, event: MessageEvent): void {
        if (!this.messageEvents.has(guildId)) {
            this.messageEvents.set(guildId, []);
        }

        const events = this.messageEvents.get(guildId)!;
        events.push(event);

        // Remove old events outside the time window
        const cutoff = Date.now() - this.TIME_WINDOW;
        const filteredEvents = events.filter(e => e.timestamp > cutoff);
        this.messageEvents.set(guildId, filteredEvents);
    }

    private detectSpam(guildId: string): { isSpam: boolean; messageCount: number; threshold: number } {
        const events = this.messageEvents.get(guildId) || [];
        const recentEvents = events.filter(e => e.timestamp > Date.now() - this.TIME_WINDOW);
        
        const messageCount = recentEvents.length;
        const isSpam = messageCount >= this.SPAM_THRESHOLD;

        return {
            isSpam,
            messageCount,
            threshold: this.SPAM_THRESHOLD
        };
    }

    private async handleSpam(guild: any, detection: { isSpam: boolean; messageCount: number; threshold: number }): Promise<void> {
        try {
            // Enable cooldown
            const cooldownStatus: CooldownStatus = {
                isActive: true,
                enabledAt: Date.now(),
                duration: this.COOLDOWN_DURATION,
                reason: `Auto-enabled due to spam: ${detection.messageCount} messages in ${this.TIME_WINDOW / 1000}s`,
                messageCount: detection.messageCount,
                threshold: detection.threshold
            };

            this.cooldownStatus.set(guild.id, cooldownStatus);

            // Set channel permissions
            await this.enableCooldown(guild);

            // Send alert
            await this.sendSpamAlert(guild, detection);

            console.log(`[AutoCooldown] Cooldown enabled for ${guild.name}: ${detection.messageCount} messages in ${this.TIME_WINDOW / 1000}s`);

        } catch (error) {
            console.error('[AutoCooldown] Error handling spam:', error);
        }
    }

    private async handleCooldownViolation(message: Message): Promise<void> {
        try {
            // Delete the message
            await message.delete().catch(() => {
                console.warn('[AutoCooldown] Could not delete message');
            });

            // Send warning to user
            const warningEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('⚠️ Chat Cooldown Active')
                .setDescription('A chat cooldown is currently active due to spam. Please wait before sending another message.')
                .addFields(
                    { name: '⏰ Cooldown Duration', value: '5 minutes', inline: true },
                    { name: '📝 Reason', value: 'Auto-enabled due to chat spam', inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await message.author.send({ embeds: [warningEmbed] }).catch(() => {
                // User has DMs disabled, ignore
            });

        } catch (error) {
            console.error('[AutoCooldown] Error handling cooldown violation:', error);
        }
    }

    private async enableCooldown(guild: any): Promise<void> {
        try {
            // Set all text channels to slowmode (5 seconds)
            const channels = guild.channels.cache.filter(channel => 
                channel.isTextBased() && 
                channel.id !== config.punishmentLogsChannelId
            );

            for (const [_, channel] of channels) {
                if (channel.isTextBased()) {
                    await channel.setRateLimitPerUser(5, 'Auto cooldown due to spam').catch(() => {
                        console.warn(`[AutoCooldown] Could not set slowmode for channel ${channel.name}`);
                    });
                }
            }

            console.log(`[AutoCooldown] Cooldown enabled for ${guild.name}`);
        } catch (error) {
            console.error('[AutoCooldown] Error enabling cooldown:', error);
        }
    }

    private async disableCooldown(guild: any): Promise<void> {
        try {
            // Remove slowmode from all text channels
            const channels = guild.channels.cache.filter(channel => 
                channel.isTextBased() && 
                channel.id !== config.punishmentLogsChannelId
            );

            for (const [_, channel] of channels) {
                if (channel.isTextBased()) {
                    await channel.setRateLimitPerUser(0, 'Auto cooldown disabled').catch(() => {
                        console.warn(`[AutoCooldown] Could not remove slowmode for channel ${channel.name}`);
                    });
                }
            }

            // Remove cooldown status
            this.cooldownStatus.delete(guild.id);

            console.log(`[AutoCooldown] Cooldown disabled for ${guild.name}`);
        } catch (error) {
            console.error('[AutoCooldown] Error disabling cooldown:', error);
        }
    }

    private async sendSpamAlert(guild: any, detection: { messageCount: number; threshold: number }): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('🚨 AUTO COOLDOWN ENABLED')
                .setDescription('Chat spam detected! A 5-minute cooldown has been automatically enabled.')
                .addFields(
                    { name: '📊 Messages Detected', value: detection.messageCount.toString(), inline: true },
                    { name: '🎯 Threshold', value: detection.threshold.toString(), inline: true },
                    { name: '⏰ Time Window', value: `${this.TIME_WINDOW / 1000}s`, inline: true },
                    { name: '🛡️ Action Taken', value: '5-second slowmode enabled on all channels', inline: false },
                    { name: '⏰ Duration', value: '5 minutes (auto-disables)', inline: true },
                    { name: '🔧 Manual Control', value: 'Use `/autocooldown disable` to disable early', inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(guild, embed);
        } catch (error) {
            console.error('[AutoCooldown] Error sending spam alert:', error);
        }
    }

    private async sendCooldownDisabledAlert(guild: any): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('success'))
                .setTitle('✅ AUTO COOLDOWN DISABLED')
                .setDescription('The chat cooldown has been automatically disabled.')
                .addFields(
                    { name: '⏰ Duration', value: '5 minutes completed', inline: true },
                    { name: '🛡️ Status', value: 'Chat restored to normal', inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(guild, embed);
        } catch (error) {
            console.error('[AutoCooldown] Error sending cooldown disabled alert:', error);
        }
    }

    private async sendAlertToStaff(guild: any, embed: EmbedBuilder): Promise<void> {
        try {
            // Send to punishment logs channel
            const logsChannel = await this.client.channels.fetch(config.punishmentLogsChannelId).catch(() => null);
            if (logsChannel && logsChannel.isTextBased() && 'send' in logsChannel) {
                await (logsChannel as any).send({ embeds: [embed] });
            } else {
                console.error('[AutoCooldown] Could not find punishment logs channel');
            }
        } catch (error) {
            console.error('[AutoCooldown] Error sending alert to logs channel:', error);
        }
    }

    private hasWhitelistedRole(member: GuildMember): boolean {
        return member.roles.cache.some(role => 
            this.WHITELISTED_ROLES.includes(role.name)
        );
    }

    private isCooldownActive(guildId: string): boolean {
        const status = this.cooldownStatus.get(guildId);
        return status ? status.isActive : false;
    }

    private cleanupOldData(): void {
        const now = Date.now();
        
        // Clean up old message events
        for (const [guildId, events] of this.messageEvents.entries()) {
            const cutoff = now - this.TIME_WINDOW;
            const filteredEvents = events.filter(e => e.timestamp > cutoff);
            this.messageEvents.set(guildId, filteredEvents);
        }
    }

    private checkAutoDisable(): void {
        const now = Date.now();
        
        for (const [guildId, status] of this.cooldownStatus.entries()) {
            if (status.isActive && (now - status.enabledAt) >= this.AUTO_DISABLE_DELAY) {
                // Auto-disable cooldown
                this.client.guilds.fetch(guildId).then(guild => {
                    this.disableCooldown(guild);
                    this.sendCooldownDisabledAlert(guild);
                }).catch(error => {
                    console.error('[AutoCooldown] Error auto-disabling cooldown:', error);
                });
            }
        }
    }

    // Public methods for manual control
    public async enableCooldownManually(guild: any, reason: string): Promise<void> {
        const cooldownStatus: CooldownStatus = {
            isActive: true,
            enabledAt: Date.now(),
            duration: this.COOLDOWN_DURATION,
            reason: `Manually enabled: ${reason}`,
            messageCount: 0,
            threshold: 0
        };

        this.cooldownStatus.set(guild.id, cooldownStatus);
        await this.enableCooldown(guild);

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('🛡️ MANUAL COOLDOWN ENABLED')
            .setDescription('A chat cooldown has been manually enabled.')
            .addFields(
                { name: '📝 Reason', value: reason, inline: true },
                { name: '⏰ Duration', value: '5 minutes', inline: true },
                { name: '🛡️ Action', value: '5-second slowmode enabled on all channels', inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await this.sendAlertToStaff(guild, embed);
    }

    public async disableCooldownManually(guild: any): Promise<void> {
        if (!this.isCooldownActive(guild.id)) {
            throw new Error('No cooldown is currently active');
        }

        await this.disableCooldown(guild);

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('✅ MANUAL COOLDOWN DISABLED')
            .setDescription('The chat cooldown has been manually disabled.')
            .addFields(
                { name: '🛡️ Status', value: 'Chat restored to normal', inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await this.sendAlertToStaff(guild, embed);
    }

    public getStatus(guildId: string): {
        isActive: boolean;
        enabledAt?: number;
        duration?: number;
        reason?: string;
        messageCount?: number;
        threshold?: number;
        recentMessages: number;
    } {
        const status = this.cooldownStatus.get(guildId);
        const events = this.messageEvents.get(guildId) || [];
        const recentMessages = events.filter(e => e.timestamp > Date.now() - this.TIME_WINDOW).length;

        return {
            isActive: status ? status.isActive : false,
            enabledAt: status?.enabledAt,
            duration: status?.duration,
            reason: status?.reason,
            messageCount: status?.messageCount,
            threshold: status?.threshold,
            recentMessages
        };
    }

    public stop(): void {
        this.messageEvents.clear();
        this.cooldownStatus.clear();
        this.isInitialized = false;
    }
}

export const autoCooldownService = AutoCooldownService.getInstance(); 