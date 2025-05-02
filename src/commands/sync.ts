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
import { mongoService } from '../services/MongoService';
import { config } from '../config/config';
import axios from 'axios';

interface DiscordProfile {
    _id: string;
    claimedInitialLinkAward: boolean;
    completedInitialSave: boolean | null;
    discordId: string | null;
    identifier: string;
    lastCachedDiscordUsername: string | null;
    notifiedOfSuccessfulLink: boolean;
}

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
                flags: 1 << 6
            };
            await interaction.reply(response);
            return;
        }

        // Connect to MongoDB and get profiles collection
        await mongoService.connect();
        const profiles = mongoService.getCollection<DiscordProfile>('DiscordProfile');

        // Get or create profile from MongoDB
        let profile = await profiles.findOne({ identifier: uuid });
        if (!profile) {
            profile = {
                _id: uuid,
                claimedInitialLinkAward: false,
                completedInitialSave: false,
                discordId: null,
                identifier: uuid,
                lastCachedDiscordUsername: null,
                notifiedOfSuccessfulLink: false
            };
        }

        // Update profile
        profile.discordId = interaction.user.id;
        profile.lastCachedDiscordUsername = interaction.user.username;

        // Save to MongoDB
        await profiles.updateOne(
            { identifier: uuid },
            { $set: profile },
            { upsert: true }
        );

        // Clean up sync code
        await redisService.deleteSyncCode(code, uuid);

        // Publish account link notification using Aware message format
        const awareMessage = {
            packetId: 'linked',
            type: 'linked',
            data: {
                'player-uuid': uuid
            }
        };
        
        console.log('[DiscordBot] [DEBUG] Starting sync process for user:', interaction.user.tag);
        console.log('[DiscordBot] [DEBUG] UUID:', uuid);
        console.log('[DiscordBot] [DEBUG] Discord ID:', interaction.user.id);
        console.log('[DiscordBot] [DEBUG] Discord Username:', interaction.user.username);
        console.log('[DiscordBot] [DEBUG] Profile before update:', JSON.stringify(profile, null, 2));
        
        console.log('[DiscordBot] [DEBUG] Publishing Aware message:', JSON.stringify(awareMessage, null, 2));
        console.log('[DiscordBot] [DEBUG] Channel: discord');
        
        try {
            await redisService.publish('discord', JSON.stringify(awareMessage));
            console.log('[DiscordBot] [DEBUG] Message published successfully');
        } catch (error) {
            console.error('[DiscordBot] [ERROR] Failed to publish message:', error);
            throw error;
        }

        if (interaction.guild && interaction.member instanceof GuildMember) {
            const verifiedRole = interaction.guild.roles.cache.find(
                role => role.name === 'Member'
            );
            
            if (verifiedRole) {
                await interaction.member.roles.add(verifiedRole);
                await interaction.member.setNickname(profile.lastCachedDiscordUsername);
            }
        }

        const successResponse: InteractionReplyOptions = {
            content: `Successfully linked your Discord account to your Minecraft account: \`${profile.lastCachedDiscordUsername}\`!`,
            flags: 1 << 6
        };
        await interaction.reply(successResponse);

    } catch (error) {
        console.error('Error handling sync modal:', error);
        const errorResponse: InteractionReplyOptions = {
            content: 'An error occurred while processing your request. Please try again later.',
            flags: 1 << 6
        };
        await interaction.reply(errorResponse);
    }
} 