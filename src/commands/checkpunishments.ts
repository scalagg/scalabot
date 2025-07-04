import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
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

export const data = new SlashCommandBuilder()
    .setName('checkpunishments')
    .setDescription('Check and sync your in-game punishment status');

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        console.log('[DEBUG] Processing checkpunishments command for user:', interaction.user.tag);
        console.log('[DEBUG] Deferring reply...');
        await interaction.deferReply({ ephemeral: true });

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
        const wasUpdated = await punishmentService.checkSpecificUser(interaction.user.id);

        // Get current punishment status for DM
        const punishments = await punishmentService.getCurrentPunishmentStatus(profile.identifier);
        if (punishments.isBanned || punishments.isBlacklisted || punishments.isMuted) {
            await punishmentService.sendCurrentStatusDM(
                interaction.member,
                punishments
            );
        }

        if (wasUpdated) {
            await interaction.editReply('✅ Your punishment status has been synced.');
        } else {
            await interaction.editReply('✅ Your punishment status is already up to date.');
        }
    } catch (error) {
        console.error('[ERROR] Failed to check punishments:', error);
        await interaction.editReply('❌ An error occurred while checking your punishment status. Please try again later.');
    }
} 