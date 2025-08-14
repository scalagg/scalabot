import { Message, EmbedBuilder, MessageContextMenuCommandInteraction } from 'discord.js';
import fetch from 'node-fetch';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';
import { sentryService } from './SentryService';

// DeepL API Response Types
interface DeepLTranslation {
    detected_source_language: string;
    text: string;
    confidence?: number;
}

interface DeepLResponse {
    translations: DeepLTranslation[];
}

class TranslationService {
    // Common Spanish words that DeepL might incorrectly detect as English
    private spanishWords = new Set([
        'hola', 'adios', 'gracias', 'por favor', 'de nada', 'buenos dias',
        'buenas tardes', 'buenas noches', 'como estas', 'bien', 'mal',
        'si', 'no', 'que', 'donde', 'cuando', 'por que', 'como', 'quien'
    ]);

    public async translateMessage(interaction: MessageContextMenuCommandInteraction): Promise<void> {
        try {
            const message = interaction.targetMessage;
            
            // Debug: Entry
            console.debug('[TranslationService] Translating message via context menu:', message.content);

            // Only translate if DeepL API key is set
            if (!config.deeplApiKey) {
                await interaction.reply({
                    content: '❌ Translation service is not configured.',
                    ephemeral: true
                });
                return;
            }

            // Skip bot messages
            if (message.author.bot) {
                await interaction.reply({
                    content: '❌ Cannot translate bot messages.',
                    ephemeral: true
                });
                return;
            }

            // Defer reply since translation might take a moment
            await interaction.deferReply({ ephemeral: true });

            // Call DeepL Free API with auto-detection
            const deeplRes = await fetch('https://api-free.deepl.com/v2/translate', {
                method: 'POST',
                headers: {
                    'Authorization': `DeepL-Auth-Key ${config.deeplApiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `text=${encodeURIComponent(message.content)}&target_lang=EN`
            });
            
            const deeplData = await deeplRes.json() as DeepLResponse;
            console.debug('[TranslationService] DeepL API response:', deeplData);
            
            if (!deeplData.translations || !deeplData.translations[0]) {
                await interaction.editReply({
                    content: '❌ Failed to translate message. Please try again.'
                });
                return;
            }
            
            const translation = deeplData.translations[0].text;
            let detectedSourceLang = deeplData.translations[0].detected_source_language;

            // Manual override for common Spanish words that DeepL might misdetect
            const trimmedMessage = message.content.trim().toLowerCase();
            if (this.spanishWords.has(trimmedMessage) && detectedSourceLang === 'EN') {
                console.debug('[TranslationService] Overriding DeepL detection for common Spanish word');
                detectedSourceLang = 'ES';
            }

            // Determine target language based on detected source
            const targetLang = detectedSourceLang === 'ES' ? 'EN' : 'ES';
            const sourceLangName = detectedSourceLang === 'ES' ? 'Spanish' : detectedSourceLang;
            const targetLangName = targetLang === 'EN' ? 'English' : 'Spanish';
            const confidence = deeplData.translations[0].confidence;

            // Send translation as an embed
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('🌐 Translation')
                .addFields(
                    { name: 'Original', value: message.content, inline: false },
                    { name: 'Translation', value: translation, inline: false },
                    { name: 'From', value: sourceLangName, inline: true },
                    { name: 'To', value: targetLangName, inline: true },
                )
                .setFooter({ text: 'Confidence: ' + confidence })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[TranslationService] Error translating message:', error);
            sentryService.captureException(error as Error, {
                context: 'translation_message',
                guild_id: interaction.guildId,
                user_id: interaction.user.id,
                message_id: interaction.targetMessage.id
            });
            await interaction.editReply({
                content: '❌ An error occurred while translating the message.'
            });
        }
    }

    // Legacy method for auto-moderation integration (if needed)
    public async translateForModeration(messageContent: string): Promise<{ translatedText: string | null; originalLanguage: string }> {
        try {
            if (!config.deeplApiKey) {
                return { translatedText: null, originalLanguage: 'EN' };
            }

            const deeplRes = await fetch('https://api-free.deepl.com/v2/translate', {
                method: 'POST',
                headers: {
                    'Authorization': `DeepL-Auth-Key ${config.deeplApiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `text=${encodeURIComponent(messageContent)}&target_lang=EN`
            });
            
            const deeplData = await deeplRes.json() as DeepLResponse;
            
            if (!deeplData.translations || !deeplData.translations[0]) {
                return { translatedText: null, originalLanguage: 'EN' };
            }
            
            const translation = deeplData.translations[0].text;
            let detectedSourceLang = deeplData.translations[0].detected_source_language;

            // Manual override for common Spanish words
            const trimmedMessage = messageContent.trim().toLowerCase();
            if (this.spanishWords.has(trimmedMessage) && detectedSourceLang === 'EN') {
                detectedSourceLang = 'ES';
            }

            return {
                translatedText: detectedSourceLang !== 'EN' ? translation : null,
                originalLanguage: detectedSourceLang
            };
        } catch (error) {
            console.error('[TranslationService] Error translating for moderation:', error);
            sentryService.captureException(error as Error, {
                context: 'translation_moderation',
                message_content_length: messageContent.length
            });
            return { translatedText: null, originalLanguage: 'EN' };
        }
    }
}

export const translationService = new TranslationService(); 