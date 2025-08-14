import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { leaderboardService } from '../services/LeaderboardService';
import { sentryService } from '../services/SentryService';

export const data = new SlashCommandBuilder()
    .setName('refreshleaderboards')
    .setDescription('Manually refresh all leaderboards')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: any) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Refresh leaderboards
        await leaderboardService.refreshAllLeaderboards();
        await leaderboardService.updateAllLeaderboardMessages();

        await interaction.editReply('✅ Leaderboards refreshed successfully!');

    } catch (error) {
        console.error('[RefreshLeaderboards] Error:', error);
        sentryService.captureException(error as Error, {
            context: 'refresh_leaderboards_command',
            user_id: interaction.user.id,
            guild_id: interaction.guildId
        });
        
        await interaction.editReply('❌ Failed to refresh leaderboards. Please try again later.');
    }
}
