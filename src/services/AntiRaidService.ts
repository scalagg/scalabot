import { 
    Client, 
    GuildMember, 
    TextChannel, 
    EmbedBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ActionRowBuilder,
    ButtonInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction,
    PermissionFlagsBits
} from 'discord.js';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';
import { moderationService } from './ModerationService';
import { redisService } from './RedisService';

interface JoinEvent {
    userId: string;
    username: string;
    accountAge: number;
    timestamp: number;
    guildId: string;
}

interface RaidDetection {
    isRaid: boolean;
    joinCount: number;
    timeWindow: number;
    suspiciousAccounts: number;
    reason: string;
}

interface VerificationChallenge {
    userId: string;
    challenge: string;
    answer: string;
    timestamp: number;
    attempts: number;
}

export class AntiRaidService {
    private static instance: AntiRaidService;
    private client!: Client;
    private joinEvents: Map<string, JoinEvent[]> = new Map(); // guildId -> events
    private verificationChallenges: Map<string, VerificationChallenge> = new Map(); // userId -> challenge
    private isHeightenedVerification: Map<string, boolean> = new Map(); // guildId -> status
    private isInitialized = false;

    // Configuration
    private readonly JOIN_THRESHOLD = 10; // Max joins in time window
    private readonly TIME_WINDOW = 30 * 1000; // 30 seconds
    private readonly NEW_ACCOUNT_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    private readonly SUSPICIOUS_USERNAME_PATTERNS = [
        /discord\.gg\//i,
        /free.*nitro/i,
        /nitro.*free/i,
        /steam.*gift/i,
        /gift.*steam/i,
        /robux.*free/i,
        /free.*robux/i,
        /minecraft.*free/i,
        /free.*minecraft/i,
        /hack.*client/i,
        /cheat.*client/i,
        /crack.*client/i,
        /premium.*free/i,
        /free.*premium/i,
        /vip.*free/i,
        /free.*vip/i,
        /admin.*free/i,
        /free.*admin/i,
        /mod.*free/i,
        /free.*mod/i
    ];

    private constructor() {}

    public static getInstance(): AntiRaidService {
        if (!AntiRaidService.instance) {
            AntiRaidService.instance = new AntiRaidService();
        }
        return AntiRaidService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
    }

    public async initialize() {
        if (this.isInitialized) return;
        
        // Clean up old data every 5 minutes
        setInterval(() => {
            this.cleanupOldData();
        }, 5 * 60 * 1000);

        this.isInitialized = true;
        console.log('[AntiRaid] Service initialized');
    }

    public async handleMemberJoin(member: GuildMember): Promise<void> {
        try {
            // Set server type
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(member.guild.id));

            // Record join event
            const joinEvent: JoinEvent = {
                userId: member.user.id,
                username: member.user.username,
                accountAge: Date.now() - member.user.createdTimestamp,
                timestamp: Date.now(),
                guildId: member.guild.id
            };

            this.recordJoinEvent(member.guild.id, joinEvent);

            // Check for raid
            const raidDetection = this.detectRaid(member.guild.id);
            
            if (raidDetection.isRaid) {
                console.log(`[AntiRaid] Raid detected in ${member.guild.name}: ${raidDetection.reason}`);
                await this.handleRaid(member.guild, raidDetection);
            }

            // Check if this specific user is suspicious
            const isSuspicious = this.isSuspiciousAccount(member);
            
            if (isSuspicious) {
                console.log(`[AntiRaid] Suspicious account detected: ${member.user.tag}`);
                await this.handleSuspiciousAccount(member);
            }

            // Handle verification based on current state
            const isHeightened = this.isHeightenedVerification.get(member.guild.id) || false;
            
            if (isHeightened) {
                await this.handleHeightenedVerification(member);
            } else {
                // Normal verification - let the existing system handle it
                console.log(`[AntiRaid] Normal verification for ${member.user.tag}`);
            }

        } catch (error) {
            console.error('[AntiRaid] Error handling member join:', error);
        }
    }

    private recordJoinEvent(guildId: string, event: JoinEvent): void {
        if (!this.joinEvents.has(guildId)) {
            this.joinEvents.set(guildId, []);
        }

        const events = this.joinEvents.get(guildId)!;
        events.push(event);

        // Remove old events outside the time window
        const cutoff = Date.now() - this.TIME_WINDOW;
        const filteredEvents = events.filter(e => e.timestamp > cutoff);
        this.joinEvents.set(guildId, filteredEvents);
    }

    private detectRaid(guildId: string): RaidDetection {
        const events = this.joinEvents.get(guildId) || [];
        const recentEvents = events.filter(e => e.timestamp > Date.now() - this.TIME_WINDOW);
        
        const suspiciousAccounts = recentEvents.filter(e => 
            e.accountAge < this.NEW_ACCOUNT_THRESHOLD || 
            this.SUSPICIOUS_USERNAME_PATTERNS.some(pattern => pattern.test(e.username))
        ).length;

        const isRaid = recentEvents.length >= this.JOIN_THRESHOLD || suspiciousAccounts >= 3;
        
        let reason = '';
        if (recentEvents.length >= this.JOIN_THRESHOLD) {
            reason = `High join rate: ${recentEvents.length} joins in ${this.TIME_WINDOW / 1000}s`;
        } else if (suspiciousAccounts >= 3) {
            reason = `Multiple suspicious accounts: ${suspiciousAccounts} detected`;
        }

        return {
            isRaid,
            joinCount: recentEvents.length,
            timeWindow: this.TIME_WINDOW,
            suspiciousAccounts,
            reason
        };
    }

    private isSuspiciousAccount(member: GuildMember): boolean {
        // Check account age
        const accountAge = Date.now() - member.user.createdTimestamp;
        if (accountAge < this.NEW_ACCOUNT_THRESHOLD) {
            return true;
        }

        // Check username for suspicious patterns
        if (this.SUSPICIOUS_USERNAME_PATTERNS.some(pattern => pattern.test(member.user.username))) {
            return true;
        }

        // Check if user is a bot (unless whitelisted)
        if (member.user.bot) {
            return true;
        }

        return false;
    }

    private async handleRaid(guild: any, detection: RaidDetection): Promise<void> {
        // Enable heightened verification
        this.isHeightenedVerification.set(guild.id, true);

        // Send alert to staff
        await this.sendRaidAlert(guild, detection);

        // Auto-mute new members if severe raid
        if (detection.joinCount >= this.JOIN_THRESHOLD * 2) {
            await this.lockdownServer(guild);
        }

        // Schedule return to normal mode
        setTimeout(() => {
            this.isHeightenedVerification.set(guild.id, false);
            this.sendRaidClearedAlert(guild);
        }, 10 * 60 * 1000); // 10 minutes
    }

    private async handleSuspiciousAccount(member: GuildMember): Promise<void> {
        try {
            // Auto-mute the suspicious account
            await member.timeout(5 * 60 * 1000, 'Suspicious account detected by anti-raid system');
            
            // Send alert
            await this.sendSuspiciousAccountAlert(member);
            
            // Create moderation action
            const moderationAction = await moderationService.createModerationAction({
                guildId: member.guild.id,
                userId: member.user.id,
                moderatorId: this.client.user!.id,
                action: 'timeout',
                reason: 'Suspicious account detected by anti-raid system',
                duration: 5 * 60 * 1000,
                evidence: `Account age: ${Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60))} hours, Username: ${member.user.username}`,
                appealable: true
            });

            // Send DM to user
            await moderationService.sendModerationDM(
                moderationAction,
                member.user,
                member,
                '5 minutes'
            );

        } catch (error) {
            console.error('[AntiRaid] Error handling suspicious account:', error);
        }
    }

    private async handleHeightenedVerification(member: GuildMember): Promise<void> {
        try {
            // Create verification challenge
            const challenge = this.generateChallenge();
            const verificationChallenge: VerificationChallenge = {
                userId: member.user.id,
                challenge: challenge.question,
                answer: challenge.answer,
                timestamp: Date.now(),
                attempts: 0
            };

            this.verificationChallenges.set(member.user.id, verificationChallenge);

            // Send verification message
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('🛡️ Heightened Verification Required')
                .setDescription('Due to recent suspicious activity, additional verification is required.')
                .addFields(
                    { name: '🔢 Challenge', value: challenge.question, inline: false },
                    { name: '⏰ Time Limit', value: '5 minutes', inline: true },
                    { name: '❌ Failure Action', value: 'Auto-kick', inline: true }
                )
                .setFooter(serverUtils.getFooter());

            const verifyButton = new ButtonBuilder()
                .setCustomId('heightened_verify')
                .setLabel('Complete Verification')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✅');

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(verifyButton);

            try {
                await member.send({ embeds: [embed], components: [row] });
            } catch (error) {
                // If DM fails, try to send in a verification channel
                console.warn(`[AntiRaid] Could not DM ${member.user.tag}, trying verification channel`);
                await this.sendVerificationToChannel(member, embed, row);
            }

            // Set timeout to kick if not verified
            setTimeout(async () => {
                const challenge = this.verificationChallenges.get(member.user.id);
                if (challenge) {
                    console.log(`[AntiRaid] Verification timeout for ${member.user.tag}`);
                    await this.kickUnverifiedMember(member);
                }
            }, 5 * 60 * 1000);

        } catch (error) {
            console.error('[AntiRaid] Error handling heightened verification:', error);
        }
    }

    private generateChallenge(): { question: string; answer: string } {
        const challenges = [
            { question: 'What is 7 + 3?', answer: '10' },
            { question: 'What is 15 - 8?', answer: '7' },
            { question: 'What is 4 × 6?', answer: '24' },
            { question: 'What is 20 ÷ 4?', answer: '5' },
            { question: 'What is 12 + 5?', answer: '17' },
            { question: 'What is 9 - 3?', answer: '6' },
            { question: 'What is 3 × 7?', answer: '21' },
            { question: 'What is 16 ÷ 2?', answer: '8' }
        ];

        return challenges[Math.floor(Math.random() * challenges.length)];
    }

    private async sendVerificationToChannel(member: GuildMember, embed: EmbedBuilder, row: ActionRowBuilder<ButtonBuilder>): Promise<void> {
        try {
            // Try to find a verification channel
            const verificationChannel = member.guild.channels.cache.find(
                channel => channel.name.toLowerCase().includes('verification') && 
                          channel.isTextBased()
            ) as TextChannel;

            if (verificationChannel) {
                await verificationChannel.send({
                    content: `${member}`,
                    embeds: [embed],
                    components: [row]
                });
            }
        } catch (error) {
            console.error('[AntiRaid] Error sending verification to channel:', error);
        }
    }

    public async handleVerificationButton(interaction: ButtonInteraction): Promise<void> {
        if (interaction.customId !== 'heightened_verify') return;

        try {
            const challenge = this.verificationChallenges.get(interaction.user.id);
            if (!challenge) {
                await interaction.reply({
                    content: '❌ No verification challenge found. Please try joining again.',
                    ephemeral: true
                });
                return;
            }

            // Show modal for answer
            const modal = new ModalBuilder()
                .setCustomId('heightened_verification_modal')
                .setTitle('Heightened Verification');

            const answerInput = new TextInputBuilder()
                .setCustomId('verification_answer')
                .setLabel('Answer the challenge')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter your answer')
                .setRequired(true)
                .setMaxLength(10);

            const actionRow = new ActionRowBuilder<TextInputBuilder>()
                .addComponents(answerInput);

            modal.addComponents(actionRow);
            await interaction.showModal(modal);

        } catch (error) {
            console.error('[AntiRaid] Error handling verification button:', error);
            await interaction.reply({
                content: '❌ An error occurred. Please try again.',
                ephemeral: true
            });
        }
    }

    public async handleVerificationModal(interaction: ModalSubmitInteraction): Promise<void> {
        if (interaction.customId !== 'heightened_verification_modal') return;

        try {
            const answer = interaction.fields.getTextInputValue('verification_answer');
            const challenge = this.verificationChallenges.get(interaction.user.id);

            if (!challenge) {
                await interaction.reply({
                    content: '❌ No verification challenge found.',
                    ephemeral: true
                });
                return;
            }

            // Check answer
            if (answer.toLowerCase().trim() === challenge.answer.toLowerCase().trim()) {
                // Success
                this.verificationChallenges.delete(interaction.user.id);
                
                const member = await interaction.guild!.members.fetch(interaction.user.id);
                await this.grantAccess(member);

                await interaction.reply({
                    content: '✅ Verification successful! You now have access to the server.',
                    ephemeral: true
                });
            } else {
                // Failed attempt
                challenge.attempts++;
                
                if (challenge.attempts >= 3) {
                    // Too many failed attempts
                    this.verificationChallenges.delete(interaction.user.id);
                    const member = await interaction.guild!.members.fetch(interaction.user.id);
                    await this.kickUnverifiedMember(member);
                    
                    await interaction.reply({
                        content: '❌ Too many failed attempts. You have been kicked from the server.',
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: `❌ Incorrect answer. You have ${3 - challenge.attempts} attempts remaining.`,
                        ephemeral: true
                    });
                }
            }

        } catch (error) {
            console.error('[AntiRaid] Error handling verification modal:', error);
            await interaction.reply({
                content: '❌ An error occurred. Please try again.',
                ephemeral: true
            });
        }
    }

    private async grantAccess(member: GuildMember): Promise<void> {
        try {
            // Add verified role
            const verifiedRole = member.guild.roles.cache.find(role => role.name === 'Member');
            if (verifiedRole) {
                await member.roles.add(verifiedRole);
            }

            // Remove timeout if any
            if (member.communicationDisabledUntil) {
                await member.timeout(null, 'Verification completed');
            }

            console.log(`[AntiRaid] Access granted to ${member.user.tag}`);
        } catch (error) {
            console.error('[AntiRaid] Error granting access:', error);
        }
    }

    private async kickUnverifiedMember(member: GuildMember): Promise<void> {
        try {
            await member.kick('Failed heightened verification');
            console.log(`[AntiRaid] Kicked unverified member: ${member.user.tag}`);
        } catch (error) {
            console.error('[AntiRaid] Error kicking unverified member:', error);
        }
    }

    private async lockdownServer(guild: any): Promise<void> {
        try {
            // Set all channels to read-only for @everyone
            const channels = guild.channels.cache.filter((channel: any) => 
                channel.isTextBased() && 
                channel.id !== config.punishmentLogsChannelId
            );

            for (const [_, channel] of channels) {
                if (channel.isTextBased()) {
                    await channel.permissionOverwrites.edit(guild.roles.everyone, {
                        SendMessages: false,
                        AddReactions: false
                    });
                }
            }

            console.log(`[AntiRaid] Server locked down: ${guild.name}`);
        } catch (error) {
            console.error('[AntiRaid] Error locking down server:', error);
        }
    }

    private async sendRaidAlert(guild: any, detection: RaidDetection): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('🚨 RAID DETECTED')
                .setDescription('The anti-raid system has detected suspicious activity.')
                .addFields(
                    { name: '📊 Join Count', value: detection.joinCount.toString(), inline: true },
                    { name: '⏰ Time Window', value: `${detection.timeWindow / 1000}s`, inline: true },
                    { name: '⚠️ Suspicious Accounts', value: detection.suspiciousAccounts.toString(), inline: true },
                    { name: '🔍 Reason', value: detection.reason, inline: false },
                    { name: '🛡️ Action Taken', value: 'Heightened verification enabled', inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(guild, embed);
        } catch (error) {
            console.error('[AntiRaid] Error sending raid alert:', error);
        }
    }

    private async sendRaidClearedAlert(guild: any): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('success'))
                .setTitle('✅ RAID CLEARED')
                .setDescription('The raid threat has passed. Returning to normal verification.')
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(guild, embed);
        } catch (error) {
            console.error('[AntiRaid] Error sending raid cleared alert:', error);
        }
    }

    private async sendSuspiciousAccountAlert(member: GuildMember): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('⚠️ Suspicious Account Detected')
                .setDescription(`A suspicious account has joined the server.`)
                .addFields(
                    { name: '👤 User', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
                    { name: '📅 Account Age', value: `${Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60))} hours`, inline: true },
                    { name: '🤖 Is Bot', value: member.user.bot ? 'Yes' : 'No', inline: true },
                    { name: '🛡️ Action Taken', value: 'Auto-muted for 5 minutes', inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await this.sendAlertToStaff(member.guild, embed);
        } catch (error) {
            console.error('[AntiRaid] Error sending suspicious account alert:', error);
        }
    }

    private async sendAlertToStaff(guild: any, embed: EmbedBuilder): Promise<void> {
        try {
            // Send to punishment logs channel
            const logsChannel = await this.client.channels.fetch(config.punishmentLogsChannelId).catch(() => null);
            if (logsChannel && logsChannel.isTextBased() && 'send' in logsChannel) {
                await (logsChannel as any).send({ embeds: [embed] });
            } else {
                console.error('[AntiRaid] Could not find punishment logs channel');
            }
        } catch (error) {
            console.error('[AntiRaid] Error sending alert to logs channel:', error);
        }
    }

    private cleanupOldData(): void {
        const now = Date.now();
        
        // Clean up old join events
        for (const [guildId, events] of this.joinEvents.entries()) {
            const cutoff = now - this.TIME_WINDOW;
            const filteredEvents = events.filter(e => e.timestamp > cutoff);
            this.joinEvents.set(guildId, filteredEvents);
        }

        // Clean up old verification challenges
        for (const [userId, challenge] of this.verificationChallenges.entries()) {
            if (now - challenge.timestamp > 10 * 60 * 1000) { // 10 minutes
                this.verificationChallenges.delete(userId);
            }
        }
    }

    public getStatus(guildId: string): {
        isHeightenedVerification: boolean;
        recentJoins: number;
        suspiciousAccounts: number;
    } {
        const events = this.joinEvents.get(guildId) || [];
        const recentEvents = events.filter(e => e.timestamp > Date.now() - this.TIME_WINDOW);
        const suspiciousAccounts = recentEvents.filter(e => 
            e.accountAge < this.NEW_ACCOUNT_THRESHOLD || 
            this.SUSPICIOUS_USERNAME_PATTERNS.some(pattern => pattern.test(e.username))
        ).length;

        return {
            isHeightenedVerification: this.isHeightenedVerification.get(guildId) || false,
            recentJoins: recentEvents.length,
            suspiciousAccounts
        };
    }

    public stop(): void {
        this.joinEvents.clear();
        this.verificationChallenges.clear();
        this.isHeightenedVerification.clear();
        this.isInitialized = false;
    }
}

export const antiRaidService = AntiRaidService.getInstance(); 