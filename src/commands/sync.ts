import { 
    CommandInteraction,
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ModalSubmitInteraction,
    GuildMember,
    ChatInputCommandInteraction
} from 'discord.js';
import type { InteractionReplyOptions } from 'discord.js';
import { redisService } from '../services/RedisService';
import { config } from '../config/config';
import axios from 'axios';

export const data = new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Link your Minecraft account to Discord');

export async function execute(interaction: ChatInputCommandInteraction) {
    const modal = new ModalBuilder()
        .setCustomId('sync-modal')
        .setTitle('Account Link');

    const codeInput = new TextInputBuilder()
        .setCustomId('code')
        .setLabel('Sync Code')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter your 7-character sync code')
        .setMinLength(6)
        .setMaxLength(7)
        .setRequired(true);

    const actionRow = new ActionRowBuilder<TextInputBuilder>()
        .addComponents(codeInput);

    modal.addComponents(actionRow);

    await interaction.showModal(modal);
}

export async function handleModal(interaction: ModalSubmitInteraction) {
    try {
        const code = interaction.fields.getTextInputValue('code');
        
        const uuid = await redisService.getSyncCode(code);
        if (!uuid) {
            const response: InteractionReplyOptions = {
                content: 'Invalid sync code. Please make sure you entered the correct code.',
                flags: 1 << 6 // Using flags for ephemeral
            };
            await interaction.reply(response);
            return;
        }

        try {
            // Get Minecraft username from API
            const response = await axios.get(`${config.apiBaseUrl}/profile/${uuid}`, {
                headers: {
                    'Authorization': `${config.apiKey}`,
                    'Accept': 'application/json'
                },
                validateStatus: null // Allow any status code
            });

            if (response.status === 401) {
                console.error('API Authentication failed. Please check your API key.');
                const errorResponse: InteractionReplyOptions = {
                    content: 'Unable to verify Minecraft account at this time. Please try again later or contact an administrator.',
                    flags: 1 << 6
                };
                await interaction.reply(errorResponse);
                return;
            }

            if (response.status !== 200) {
                console.error(`API request failed with status ${response.status}:`, response.data);
                const errorResponse: InteractionReplyOptions = {
                    content: 'Failed to fetch Minecraft account information. Please try again later.',
                    flags: 1 << 6
                };
                await interaction.reply(errorResponse);
                return;
            }

            const minecraftUsername = response.data.name;

            const profile = await redisService.getProfile(uuid) || {
                identifier: uuid,
                notifiedOfSuccessfulLink: false,
                claimedInitialLinkAward: false
            };

            profile.discordId = interaction.user.id;
            profile.lastCachedDiscordUsername = interaction.user.username;

            await redisService.saveProfile(profile);
            await redisService.deleteSyncCode(code, uuid);

            // Publish account link notification using Aware message format
            await redisService.publish('discord:linked', JSON.stringify({
                type: 'linked',
                data: {
                    'player-uuid': uuid
                }
            }));

            if (interaction.guild && interaction.member instanceof GuildMember) {
                const verifiedRole = interaction.guild.roles.cache.find(
                    role => role.name === '✓ Account Linked'
                );
                
                if (verifiedRole) {
                    await interaction.member.roles.add(verifiedRole);
                    await interaction.member.setNickname(minecraftUsername);
                }
            }

            const successResponse: InteractionReplyOptions = {
                content: `Successfully linked your Discord account to your Minecraft account: \`${minecraftUsername}\`!`,
                flags: 1 << 6
            };
            await interaction.reply(successResponse);

        } catch (apiError) {
            console.error('API request error:', apiError);
            const errorResponse: InteractionReplyOptions = {
                content: 'Failed to communicate with the Minecraft server. Please try again later.',
                flags: 1 << 6
            };
            await interaction.reply(errorResponse);
        }
    } catch (error) {
        console.error('Error handling sync modal:', error);
        const errorResponse: InteractionReplyOptions = {
            content: 'An error occurred while processing your request. Please try again later.',
            flags: 1 << 6
        };
        await interaction.reply(errorResponse);
    }
} 