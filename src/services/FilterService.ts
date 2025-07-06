import { 
    Message, 
    TextChannel, 
    EmbedBuilder,
    PermissionFlagsBits,
    GuildMember
} from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';
import { config } from '../config/config';

interface FilterConfig {
    enabled: boolean;
    bannedWords: string[];
    whitelistedChannels: string[];
    whitelistedRoles: string[];
    whitelistedUsers: string[];
    action: 'block' | 'warn' | 'delete';
    logViolations: boolean;
}

export class FilterService {
    private static instance: FilterService;
    private client: any;
    private config: FilterConfig;
    private isInitialized = false;

    private constructor() {
        this.config = {
            enabled: true,
            bannedWords: [
                '🙋🏻‍♂️🇩🇪', 'autist', 'beaner', 'chink', 'dilf', 'dox', 'doxxed', 'dtf', 'dyke', 'Dyke', 
                'fag', 'Faggot', 'gringo', 'gulag', 'Heil', 'hitler', 'honkey', 'incest', 'kapo', 
                'kill yourself', 'killyourself', 'kurac', 'kys', 'mengele', 'milf', 'nazi', 'niger', 
                'Nigga', 'Nigger', 'niggie', 'shemale', 'stalin', 'std', 'swastika', 'swatted', 
                'Tranny', 'troon', 'Trump', 'ValidLs', 'zedong'
            ],
            whitelistedChannels: [],
            whitelistedRoles: [
                'Admin', 'Senior Admin', 'System Admin', 'Platform Admin', 'Co-Owner', 'Owner'
            ],
            whitelistedUsers: [],
            action: 'block',
            logViolations: true
        };
    }

    public static getInstance(): FilterService {
        if (!FilterService.instance) {
            FilterService.instance = new FilterService();
        }
        return FilterService.instance;
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
        console.log('[FilterService] Initialized');
    }

    private async handleMessage(message: Message) {
        console.log(`[FilterService] Message received from ${message.author.tag}: "${message.content}"`);
        
        // Ignore bot messages
        if (message.author.bot) {
            console.log('[FilterService] Ignoring bot message');
            return;
        }

        // Ignore DMs
        if (!message.guild) {
            console.log('[FilterService] Ignoring DM message');
            return;
        }

        // Set server type
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(message.guild.id));

        // Check if filtering is enabled
        if (!this.config.enabled) {
            console.log('[FilterService] Filtering is disabled');
            return;
        }

        // Check if channel is whitelisted
        if (this.config.whitelistedChannels.includes(message.channel.id)) {
            console.log(`[FilterService] Channel ${message.channel instanceof TextChannel ? message.channel.name : message.channel.id} is whitelisted`);
            return;
        }

        // Check if user is whitelisted
        if (this.config.whitelistedUsers.includes(message.author.id)) {
            console.log(`[FilterService] User ${message.author.tag} is whitelisted`);
            return;
        }

        // Check if user has whitelisted role
        if (message.member) {
            const hasWhitelistedRole = message.member.roles.cache.some(role => 
                this.config.whitelistedRoles.includes(role.name)
            );
            if (hasWhitelistedRole) {
                console.log(`[FilterService] User ${message.author.tag} has whitelisted role`);
                return;
            }
        }

        // Check message content
        const violations = this.checkMessage(message.content);
        console.log(`[FilterService] Found ${violations.length} violations:`, violations);
        
        if (violations.length > 0) {
            console.log(`[FilterService] Handling violation for message: "${message.content}"`);
            await this.handleViolation(message, violations);
        }
    }

    private checkMessage(content: string): string[] {
        const violations: string[] = [];
        const normalizedContent = content.toLowerCase();
        
        console.log(`[FilterService] Checking message: "${content}"`);
        console.log(`[FilterService] Normalized content: "${normalizedContent}"`);
        console.log(`[FilterService] Banned words:`, this.config.bannedWords);

        for (const word of this.config.bannedWords) {
            const normalizedWord = word.toLowerCase();
            
            // Check for exact word match (with word boundaries)
            const wordRegex = new RegExp(`\\b${this.escapeRegex(normalizedWord)}\\b`, 'i');
            const regexMatch = wordRegex.test(normalizedContent);
            
            // Also check for word as part of larger word (for cases like "kys" in "kys123")
            const includesMatch = normalizedContent.includes(normalizedWord);
            
            console.log(`[FilterService] Checking word "${word}": regex=${regexMatch}, includes=${includesMatch}`);
            
            if (regexMatch || includesMatch) {
                violations.push(word);
                console.log(`[FilterService] Found violation: "${word}"`);
            }
        }

        return violations;
    }

    private escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private async handleViolation(message: Message, violations: string[]) {
        try {
            // Delete the message
            await message.delete();

            // Create violation embed
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('🚫 Message Blocked')
                .setDescription('Your message was blocked due to inappropriate content.')
                .addFields(
                    { 
                        name: '❌ Violations', 
                        value: violations.map(v => `\`${v}\``).join(', '), 
                        inline: false 
                    },
                    { 
                        name: '📝 Original Message', 
                        value: message.content.length > 1024 
                            ? message.content.substring(0, 1021) + '...' 
                            : message.content, 
                        inline: false 
                    }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            // Send warning to user
            const warningEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('⚠️ Message Blocked')
                .setDescription('Your message contained inappropriate content and was blocked.')
                .addFields(
                    { 
                        name: '🚫 Blocked Words', 
                        value: violations.map(v => `\`${v}\``).join(', '), 
                        inline: false 
                    }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            // Try to send warning to user
            try {
                await message.author.send({ embeds: [warningEmbed] });
            } catch (dmError) {
                // If DM fails, send in channel (ephemeral if possible)
                if (message.channel.isTextBased() && message.channel instanceof TextChannel) {
                    await message.channel.send({
                        content: `${message.author} Your message was blocked. Check your DMs for details.`,
                        embeds: [warningEmbed]
                    });
                }
            }

            // Log violation if enabled
            if (this.config.logViolations) {
                await this.logViolation(message, violations, embed);
            }

        } catch (error) {
            console.error('[FilterService] Error handling violation:', error);
        }
    }

    private async logViolation(message: Message, violations: string[], embed: EmbedBuilder) {
        try {
            // Try to find a logging channel
            const loggingChannel = await this.findLoggingChannel(message.guild!);
            
            if (loggingChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('error'))
                    .setTitle('🚫 Filter Violation')
                    .setDescription(`Message blocked from ${message.author.tag}`)
                    .addFields(
                        { name: '👤 User', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                        { name: '📝 Channel', value: `${message.channel} (<#${message.channel.id}>)`, inline: true },
                        { name: '🚫 Violations', value: violations.map(v => `\`${v}\``).join(', '), inline: false },
                        { name: '📄 Original Message', value: message.content.length > 1024 ? message.content.substring(0, 1021) + '...' : message.content, inline: false }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await loggingChannel.send({ embeds: [logEmbed] });
            }
        } catch (error) {
            console.error('[FilterService] Error logging violation:', error);
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
            console.error('[FilterService] Error getting log channel:', error);
            return null;
        }
    }

    // Configuration methods
    public addBannedWord(word: string) {
        if (!this.config.bannedWords.includes(word)) {
            this.config.bannedWords.push(word);
        }
    }

    public removeBannedWord(word: string) {
        const index = this.config.bannedWords.indexOf(word);
        if (index > -1) {
            this.config.bannedWords.splice(index, 1);
        }
    }

    public getBannedWords(): string[] {
        return [...this.config.bannedWords];
    }

    public setEnabled(enabled: boolean) {
        this.config.enabled = enabled;
    }

    public isEnabled(): boolean {
        return this.config.enabled;
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

    public getConfig(): FilterConfig {
        return { ...this.config };
    }
}

export const filterService = FilterService.getInstance(); 