import { Client, Message, GuildMember, TextChannel, EmbedBuilder } from 'discord.js';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';
import { moderationService } from './ModerationService';
import { translationService } from './TranslationService';

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
    callback: (prediction: number, context?: { originalLanguage: string; translatedText: string | null; wasTranslated: boolean }) => void;
}

interface TokenInfo {
    token: string;
    lastUsed: number;
    rateLimitUntil: number;
    consecutiveFailures: number;
}

export class AutoModerationService {
    private static instance: AutoModerationService;
    private client!: Client;
    private queue: AutoModerationMessage[] = [];
    private isProcessing = false;
    private tokens: Map<string, TokenInfo> = new Map();
    private currentTokenIndex = 0;
    private maxConcurrentRequests = 3;
    private activeRequests = 0;

    private constructor() {
        this.initializeTokens();
    }

    public static getInstance(): AutoModerationService {
        if (!AutoModerationService.instance) {
            AutoModerationService.instance = new AutoModerationService();
        }
        return AutoModerationService.instance;
    }

    private initializeTokens() {
        const apiKeys = config.geminiConfig.apiKey.split(',').map(key => key.trim()).filter(key => key.length > 0);
        
        if (apiKeys.length === 0) {
            console.warn('[AutoModeration] No API keys configured');
            return;
        }

        console.log(`[AutoModeration] Initialized ${apiKeys.length} API keys`);
        
        apiKeys.forEach((token, index) => {
            this.tokens.set(token, {
                token,
                lastUsed: 0,
                rateLimitUntil: 0,
                consecutiveFailures: 0
            });
        });
    }

    public setClient(client: Client) {
        this.client = client;
        this.startProcessing();
    }

    public submit(message: Message, callback: (prediction: number, context?: { originalLanguage: string; translatedText: string | null; wasTranslated: boolean }) => void) {
        this.queue.push({ message, callback });
    }

    private async startProcessing() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.isProcessing) {
            if (this.activeRequests >= this.maxConcurrentRequests) {
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }

            const nextMessage = this.queue.shift();
            if (!nextMessage) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            this.activeRequests++;
            this.processMessage(nextMessage).finally(() => {
                this.activeRequests--;
            });
        }
    }

    private async processMessage(autoModMessage: AutoModerationMessage) {
        const { message, callback } = autoModMessage;
        
        // Check if automoderation is enabled
        if (!config.geminiConfig.enabled) {
            return;
        }

        const apiToken = this.getAvailableToken();
        if (!apiToken) {
            console.warn('[AutoModeration] No available API tokens, skipping message');
            return;
        }

        // Translate the message to English for consistent moderation
        let messageToAnalyze = message.content;
        let originalLanguage = 'EN';
        let translatedText = null;

        try {
            // Use the translation service for moderation
            const translationResult = await translationService.translateForModeration(message.content);
            
            if (translationResult.translatedText) {
                translatedText = translationResult.translatedText;
                messageToAnalyze = translatedText;
                originalLanguage = translationResult.originalLanguage;
                console.log(`[AutoModeration] Translated message from ${originalLanguage} to English for analysis`);
            }
        } catch (error) {
            console.warn('[AutoModeration] Translation failed, using original message:', error);
            // Continue with original message if translation fails
        }

        const prompt = config.geminiConfig.generativeAIPrompt.replace('%s', messageToAnalyze);

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

            if (response.status === 429) {
                // Rate limited - mark token as rate limited
                this.markTokenRateLimited(apiToken);
                console.warn(`[AutoModeration] Token rate limited, will retry with different token`);
                
                // Re-queue the message for retry
                setTimeout(() => {
                    this.queue.unshift(autoModMessage);
                }, 1000);
                return;
            }

            if (!response.ok) {
                this.markTokenFailure(apiToken);
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }

            const geminiResponse: GeminiResponse = await response.json();
            const prediction = this.extractFirstNumber(geminiResponse);
            
            if (prediction !== null) {
                this.markTokenSuccess(apiToken);
                // Pass additional context about translation
                callback(prediction, {
                    originalLanguage,
                    translatedText,
                    wasTranslated: translatedText !== null
                });
            } else {
                this.markTokenFailure(apiToken);
            }

        } catch (error) {
            console.error('[AutoModeration] Error calling Gemini API:', error);
            this.markTokenFailure(apiToken);
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
        const now = Date.now();
        const availableTokens: string[] = [];

        // Find all available tokens
        for (const [token, info] of this.tokens.entries()) {
            if (now >= info.rateLimitUntil && info.consecutiveFailures < 3) {
                availableTokens.push(token);
            }
        }

        if (availableTokens.length === 0) {
            // If no tokens are available, reset all tokens after a longer delay
            const resetTime = now + 60000; // 1 minute
            for (const [token, info] of this.tokens.entries()) {
                if (now >= info.rateLimitUntil + 60000) {
                    info.rateLimitUntil = 0;
                    info.consecutiveFailures = 0;
                    availableTokens.push(token);
                }
            }
        }

        if (availableTokens.length === 0) {
            return null;
        }

        // Use round-robin selection from available tokens
        const selectedToken = availableTokens[this.currentTokenIndex % availableTokens.length];
        this.currentTokenIndex = (this.currentTokenIndex + 1) % availableTokens.length;
        
        return selectedToken;
    }

    private markTokenSuccess(token: string) {
        const info = this.tokens.get(token);
        if (info) {
            info.lastUsed = Date.now();
            info.consecutiveFailures = 0;
            info.rateLimitUntil = 0;
        }
    }

    private markTokenFailure(token: string) {
        const info = this.tokens.get(token);
        if (info) {
            info.lastUsed = Date.now();
            info.consecutiveFailures++;
            
            // Exponential backoff: 2^failures seconds
            const backoffSeconds = Math.min(Math.pow(2, info.consecutiveFailures), 60);
            info.rateLimitUntil = Date.now() + (backoffSeconds * 1000);
            
            console.log(`[AutoModeration] Token ${token.substring(0, 10)}... failed ${info.consecutiveFailures} times, backing off for ${backoffSeconds}s`);
        }
    }

    private markTokenRateLimited(token: string) {
        const info = this.tokens.get(token);
        if (info) {
            info.lastUsed = Date.now();
            info.consecutiveFailures++;
            // Rate limit backoff: 30 seconds minimum
            info.rateLimitUntil = Date.now() + 30000;
            
            console.log(`[AutoModeration] Token ${token.substring(0, 10)}... rate limited, backing off for 30s`);
        }
    }

    public async handleToxicMessage(message: Message, toxicityScore: number, translationContext?: { originalLanguage: string; translatedText: string | null; wasTranslated: boolean }) {
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
                await this.sendStaffWarning(message, toxicityScore, translationContext);
                return;
            }

            console.log(`[AutoModeration] Creating moderation action for ${message.author.tag}`);

            // Create moderation action with translation context
            const reason = translationContext?.wasTranslated 
                ? `Auto-moderation: Toxic message detected (Score: ${toxicityScore}/100) - Original language: ${translationContext.originalLanguage}`
                : `Auto-moderation: Toxic message detected (Score: ${toxicityScore}/100)`;

            const evidence = translationContext?.wasTranslated
                ? `Original message: "${message.content}" | Translated: "${translationContext.translatedText}"`
                : `Original message: "${message.content}"`;

            const moderationAction = await moderationService.createModerationAction({
                guildId: message.guildId!,
                userId: message.author.id,
                moderatorId: this.client.user!.id,
                action: 'timeout',
                reason,
                duration: 5 * 60 * 1000, // 5 minutes
                evidence,
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
                    evidence
                }
            );

            // Send warning message in channel
            await this.sendAutoModerationWarning(message, toxicityScore, moderationAction.punishmentId, translationContext);

            console.log(`[AutoModeration] Successfully processed toxic message from ${message.author.tag}`);

        } catch (error) {
            console.error('[AutoModeration] Error handling toxic message:', error);
        }
    }

    private async sendAutoModerationWarning(message: Message, toxicityScore: number, punishmentId: string, translationContext?: { originalLanguage: string; translatedText: string | null; wasTranslated: boolean }) {
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

        // Add translation information if the message was translated
        if (translationContext?.wasTranslated) {
            embed.addFields(
                { name: '🌐 Language', value: translationContext.originalLanguage, inline: true },
                { name: '📖 Translation', value: translationContext.translatedText || 'N/A', inline: false }
            );
        }

        if (message.channel instanceof TextChannel) {
            await message.channel.send({ embeds: [embed] });
        }
    }

    private async sendStaffWarning(message: Message, toxicityScore: number, translationContext?: { originalLanguage: string; translatedText: string | null; wasTranslated: boolean }) {
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

        // Add translation information if the message was translated
        if (translationContext?.wasTranslated) {
            embed.addFields(
                { name: '🌐 Language', value: translationContext.originalLanguage, inline: true },
                { name: '📖 Translation', value: translationContext.translatedText || 'N/A', inline: false }
            );
        }

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

    public getTokenStatus(): { total: number; available: number; rateLimited: number; failed: number } {
        const now = Date.now();
        let available = 0;
        let rateLimited = 0;
        let failed = 0;

        for (const [token, info] of this.tokens.entries()) {
            if (now >= info.rateLimitUntil && info.consecutiveFailures < 3) {
                available++;
            } else if (info.consecutiveFailures >= 3) {
                failed++;
            } else {
                rateLimited++;
            }
        }

        return {
            total: this.tokens.size,
            available,
            rateLimited,
            failed
        };
    }

    public getDetailedTokenStatus(): Array<{ token: string; status: string; lastUsed: number; failures: number; backoffUntil: number }> {
        const now = Date.now();
        const status: Array<{ token: string; status: string; lastUsed: number; failures: number; backoffUntil: number }> = [];

        for (const [token, info] of this.tokens.entries()) {
            let statusStr = 'available';
            if (info.consecutiveFailures >= 3) {
                statusStr = 'failed';
            } else if (now < info.rateLimitUntil) {
                statusStr = 'rate_limited';
            }

            status.push({
                token: token.substring(0, 10) + '...',
                status: statusStr,
                lastUsed: info.lastUsed,
                failures: info.consecutiveFailures,
                backoffUntil: info.rateLimitUntil
            });
        }

        return status;
    }

    public stop() {
        this.isProcessing = false;
    }
}

export const autoModerationService = AutoModerationService.getInstance();
