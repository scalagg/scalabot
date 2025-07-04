import { ChatInputCommandInteraction, SlashCommandBuilder, GuildMember } from 'discord.js';
import { mongoService } from '../services/MongoService';
import { PunishmentService } from '../services/PunishmentService';
import type { Document } from 'mongodb';

interface BaseDiscordProfile {
    _id: string;
    claimedInitialLinkAward: boolean;
    completedInitialSave: boolean | null;
    discordId: string | null;
    identifier: string;
    lastCachedDiscordUsername: string | null;
    notifiedOfSuccessfulLink: boolean;
}

type DiscordProfile = BaseDiscordProfile & Document;

interface DiscordAPIError {
    code: number;
    message: string;
}

export const data = new SlashCommandBuilder()
    .setName('checkpunishments')
    .setDescription('Check and sync your in-game punishment status');

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        console.log('[DEBUG] Processing checkpunishments command for user:', interaction.user.tag);
        
        // First reply immediately to prevent timeout
        await interaction.reply({ 
            content: '🔍 Checking your punishment status...', 
            ephemeral: true 
        });

        // Connect to MongoDB
        console.log('[MongoDB] Connecting...');
        await mongoService.connect();

        // Find the user's profile
        const profiles = mongoService.getCollection<DiscordProfile>('DiscordProfile');
        const profile = await profiles.findOne({ discordId: interaction.user.id });

        if (!profile) {
            await interaction.editReply('❌ No linked Minecraft account found. Please verify your account first.');
            return;
        }

        console.log('[DEBUG] Found profile:', {
            discordId: profile.discordId,
            uuid: profile.identifier,
            username: profile.lastCachedDiscordUsername,
        });

        const punishmentService = PunishmentService.getInstance();
        console.log('[DEBUG] Checking punishments...');
        
        // Run these in parallel to speed things up
        const [wasUpdated, punishments] = await Promise.all([
            punishmentService.checkSpecificUser(interaction.user.id),
            punishmentService.getCurrentPunishmentStatus(profile.identifier)
        ]);

        // Try to send DM if there are active punishments
        let dmSent = false;
        if (punishments.isBanned || punishments.isBlacklisted || punishments.isMuted) {
            if (interaction.member instanceof GuildMember) {
                try {
                    await punishmentService.sendCurrentStatusDM(
                        interaction.member,
                        punishments
                    );
                    dmSent = true;
                } catch (error) {
                    console.error('[DEBUG] Failed to send DM:', error);
                }
            }
        }

        // Build response message
        let response = wasUpdated 
            ? '✅ Your punishment status has been synced.' 
            : '✅ Your punishment status is already up to date.';

        // Add DM status to response
        if (punishments.isBanned || punishments.isBlacklisted || punishments.isMuted) {
            response += dmSent 
                ? '\n📬 Check your DMs for detailed information about your punishments.'
                : '\n⚠️ I couldn\'t send you a DM. Please enable DMs from server members to receive punishment notifications.';
        }

        await interaction.editReply(response);
    } catch (error) {
        console.error('[ERROR] Failed to check punishments:', error);
        
        // Handle interaction timeout
        const errorMessage = (error as DiscordAPIError).code === 10062 
            ? '⚠️ The command timed out. Please try again.'
            : '❌ An error occurred while checking your punishment status. Please try again later.';

        try {
            await interaction.editReply(errorMessage);
        } catch {
            // If we can't edit the reply, try to send a new one
            try {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            } catch (e) {
                console.error('[ERROR] Failed to send error message:', e);
            }
        }
    }
} 