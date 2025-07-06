import { Message, EmbedBuilder } from 'discord.js';
import fetch from 'node-fetch';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';

class TranslationService {
    public async translateIfNeeded(message: Message): Promise<void> {
        try {
            // TODO: Add proper DeepL API response typing
            // Debug: Entry
            console.debug('[TranslationService] Checking message:', message.content);

            // Only translate if DeepL API key is set
            if (!config.deeplApiKey) {
                console.debug('[TranslationService] No DeepL API key set. Skipping.');
                return;
            }

            // Skip bot messages, DMs, and commands
            if (message.author.bot || !message.guild) {
                console.debug('[TranslationService] Skipping bot/DM message.');
                return;
            }
            if (/^[!/.]/.test(message.content.trim())) {
                console.debug('[TranslationService] Skipping command message.');
                return;
            }

            // Always attempt translation - let DeepL handle language detection
            console.debug('[TranslationService] Attempting translation...');

            // Call DeepL Free API with auto-detection
            const deeplRes = await fetch('https://api-free.deepl.com/v2/translate', {
                method: 'POST',
                headers: {
                    'Authorization': `DeepL-Auth-Key ${config.deeplApiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `text=${encodeURIComponent(message.content)}&target_lang=EN`
            });
            
            const deeplData = await deeplRes.json() as any;
            console.debug('[TranslationService] DeepL API response:', deeplData);
            
            if (!deeplData.translations || !deeplData.translations[0]) {
                console.debug('[TranslationService] No translation received from DeepL');
                return;
            }
            
            const translation = deeplData.translations[0].text;
            const detectedSourceLang = deeplData.translations[0].detected_source_language;

            // Only translate if source is not English (to avoid translating English to English)
            if (detectedSourceLang === 'EN') {
                console.debug('[TranslationService] Source is already English, skipping translation');
                return;
            }

            // Determine target language based on detected source
            const targetLang = detectedSourceLang === 'ES' ? 'EN' : 'ES';
            const sourceLangName = detectedSourceLang === 'ES' ? 'Spanish' : detectedSourceLang;
            const targetLangName = targetLang === 'EN' ? 'English' : 'Spanish';
            const confidence = deeplData.translations[0].confidence;

            // Send translation as an embed
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('🌐 Auto-Translation')
                .addFields(
                    { name: 'Original', value: message.content, inline: false },
                    { name: 'Translation', value: translation, inline: false },
                    { name: 'From', value: sourceLangName, inline: true },
                    { name: 'To', value: targetLangName, inline: true },
                )
                .setFooter({ text: 'Confidence: ' + confidence })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('[TranslationService] Error translating message:', error);
        }
    }
}

export const translationService = new TranslationService(); 