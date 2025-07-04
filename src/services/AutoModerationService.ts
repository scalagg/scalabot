import { Client, Message, GuildMember, TextChannel, EmbedBuilder } from 'discord.js';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';
import { moderationService } from './ModerationService';

interface GeminiRequest {
    contents: GeminiRequestContent[];
    safetySettings: SafetySetting[];
}

interface GeminiRequestContent {
    parts: Part[];
}

interface Part {
    text: string;
}

interface SafetySetting {
    category: string;
    threshold: string;
}

interface GeminiResponse {
    candidates: Candidate[];
    usageMetadata: UsageMetadata;
}

interface Candidate {
    content: Content;
    finishReason: string;
    index: number;
    safetyRatings: SafetyRating[];
}

interface Content {
    parts: Part[];
    role: string;
}

interface SafetyRating {
    category: string;
    probability: string;
}

interface UsageMetadata {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
}

interface AutoModerationMessage {
    message: Message;
    callback: (prediction: number) => void;
}

export class AutoModerationService {
    private static instance: AutoModerationService;
    private client!: Client;
    private queue: AutoModerationMessage[] = [];
    private isProcessing = false;
    private testedTokens = new Map<string, number>();

    private constructor() {}

    public static getInstance(): AutoModerationService {
        if (!AutoModerationService.instance) {
            AutoModerationService.instance = new AutoModerationService();
        }
        return AutoModerationService.instance;
    }

    public setClient(client: Client) {
        this.client = client;
        this.startProcessing();
    }

    public submit(message: Message, callback: (prediction: number) => void) {
        this.queue.push({ message, callback });
    }

    private async startProcessing() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.isProcessing) {
            const nextMessage = this.queue.shift();
            if (!nextMessage) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            try {
                await this.processMessage(nextMessage);
            } catch (error) {
                console.error('[AutoModeration] Error processing message:', error);
            }
        }
    }

    private async processMessage(autoModMessage: AutoModerationMessage) {
        const { message, callback } = autoModMessage;
        
        // Check if automoderation is enabled
        if (!config.geminiConfig.enabled) {
            return;
        }

        // Clean up old tested tokens (older than 1 minute)
        const now = Date.now();
        for (const [token, timestamp] of this.testedTokens.entries()) {
            if (now - timestamp > 60000) {
                this.testedTokens.delete(token);
            }
        }

        const apiToken = this.getAvailableToken();
        if (!apiToken) {
            console.warn('[AutoModeration] No available API tokens');
            return;
        }

        const prompt = config.geminiConfig.generativeAIPrompt.replace('%s', message.content);

        const geminiRequest: GeminiRequest = {
            contents: [
                {
                    parts: [{ text: prompt }]
                }
            ],
            safetySettings: [
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
            ]
        };

        try {
            const response = await fetch(
                config.geminiConfig.apiEndpoint.replace('%s', apiToken),
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(geminiRequest)
                }
            );

            if (!response.ok) {
                this.testedTokens.set(apiToken, now);
                throw new Error(`API request failed: ${response.status}`);
            }

            const geminiResponse: GeminiResponse = await response.json();
            const prediction = this.extractFirstNumber(geminiResponse);
            
            if (prediction !== null) {
                callback(prediction);
            }

        } catch (error) {
            console.error('[AutoModeration] Error calling Gemini API:', error);
            this.testedTokens.set(apiToken, now);
        }
    }

    private extractFirstNumber(response: GeminiResponse): number | null {
        const firstCandidate = response.candidates[0];
        if (!firstCandidate) return null;

        const firstPartText = firstCandidate.content.parts[0]?.text;
        if (!firstPartText) return null;

        const regex = /\d+/;
        const match = firstPartText.match(regex);
        return match ? parseInt(match[0]) : null;
    }

    private getAvailableToken(): string | null {
        const tokens = config.geminiConfig.apiKey.split(',').map((t: string) => t.trim());
        return tokens.find((token: string) => !this.testedTokens.has(token)) || null;
    }

    public async handleToxicMessage(message: Message, toxicityScore: number) {
        if (toxicityScore < config.geminiConfig.muteThreshold) {
            return; // Not toxic enough to act on
        }

        try {
            console.log(`[AutoModeration] Processing toxic message from ${message.author.tag} (Score: ${toxicityScore}/100)`);
            
            // Set server type based on guild ID
            serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(message.guildId!));

            // Delete the toxic message
            await message.delete().catch(() => {
                console.warn('[AutoModeration] Could not delete message');
            });

            // Get member
            const member = message.member;
            if (!member) return;

            // Check if user has staff role (don't auto-mute staff)
            if (serverUtils.hasStaffRole(member)) {
                console.log(`[AutoModeration] Staff member ${message.author.tag} sent toxic message, sending warning only`);
                await this.sendStaffWarning(message, toxicityScore);
                return;
            }

            console.log(`[AutoModeration] Creating moderation action for ${message.author.tag}`);

            // Create moderation action
            const moderationAction = await moderationService.createModerationAction({
                guildId: message.guildId!,
                userId: message.author.id,
                moderatorId: this.client.user!.id,
                action: 'timeout',
                reason: `Auto-moderation: Toxic message detected (Score: ${toxicityScore}/100)`,
                duration: 5 * 60 * 1000, // 5 minutes
                evidence: `Original message: "${message.content}"`,
                appealable: true
            });

            console.log(`[AutoModeration] Created moderation action: ${moderationAction.punishmentId}`);

            // Timeout the user
            await member.timeout(
                5 * 60 * 1000, // 5 minutes
                `Auto-moderation: Toxic message (Score: ${toxicityScore}/100) | Punishment ID: ${moderationAction.punishmentId}`
            );

            console.log(`[AutoModeration] Timed out user ${message.author.tag} for 5 minutes`);

            // Send DM to user
            await moderationService.sendModerationDM(
                moderationAction,
                message.author,
                member,
                '5 minutes'
            );

            // Send log to moderation channel
            console.log(`[AutoModeration] Sending log to punishment logs channel: ${config.punishmentLogsChannelId}`);
            await moderationService.sendModerationLog(
                moderationAction,
                message.author,
                member,
                { 
                    duration: '5 minutes',
                    evidence: `Original message: "${message.content}"`
                }
            );

            // Send warning message in channel
            await this.sendAutoModerationWarning(message, toxicityScore, moderationAction.punishmentId);

            console.log(`[AutoModeration] Successfully processed toxic message from ${message.author.tag}`);

        } catch (error) {
            console.error('[AutoModeration] Error handling toxic message:', error);
        }
    }

    private async sendAutoModerationWarning(message: Message, toxicityScore: number, punishmentId: string) {
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('🤖 Auto-Moderation Action')
            .setDescription(`**${message.author.tag}** has been automatically timed out for 5 minutes.`)
            .addFields(
                { name: '👤 User', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                { name: '🤖 Moderator', value: 'Auto-Moderation System', inline: true },
                { name: '📊 Toxicity Score', value: `${toxicityScore}/100`, inline: true },
                { name: '📝 Reason', value: 'Toxic message detected by AI moderation system', inline: false },
                { name: '🆔 Punishment ID', value: punishmentId, inline: true },
                { name: '⏰ Duration', value: '5 minutes', inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (message.channel instanceof TextChannel) {
            await message.channel.send({ embeds: [embed] });
        }
    }

    private async sendStaffWarning(message: Message, toxicityScore: number) {
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('⚠️ Staff Message Warning')
            .setDescription(`**${message.author.tag}**, your message was flagged by our AI moderation system.`)
            .addFields(
                { name: '📊 Toxicity Score', value: `${toxicityScore}/100`, inline: true },
                { name: '📝 Message', value: `"${message.content}"`, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        try {
            await message.author.send({ embeds: [embed] });
        } catch (error) {
            console.warn('[AutoModeration] Could not send DM to staff member');
        }
    }

    public async checkLoggingChannel(): Promise<boolean> {
        try {
            const channel = await this.client.channels.fetch(config.punishmentLogsChannelId);
            if (!channel) {
                console.error(`[AutoModeration] Punishment logs channel not found: ${config.punishmentLogsChannelId}`);
                return false;
            }
            
            if (!(channel instanceof TextChannel)) {
                console.error(`[AutoModeration] Punishment logs channel is not a text channel: ${config.punishmentLogsChannelId}`);
                return false;
            }
            
            const permissions = channel.permissionsFor(this.client.user!);
            if (!permissions?.has('SendMessages')) {
                console.error(`[AutoModeration] Bot does not have permission to send messages in punishment logs channel: ${config.punishmentLogsChannelId}`);
                return false;
            }
            
            console.log(`[AutoModeration] Punishment logs channel verified: #${channel.name} (${config.punishmentLogsChannelId})`);
            return true;
        } catch (error) {
            console.error(`[AutoModeration] Error checking punishment logs channel:`, error);
            return false;
        }
    }

    public stop() {
        this.isProcessing = false;
    }
}

export const autoModerationService = AutoModerationService.getInstance();
