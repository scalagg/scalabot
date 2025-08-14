import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { leaderboardService, LeaderboardType } from '../services/LeaderboardService';
import { sentryService } from '../services/SentryService';

export const data = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View server leaderboards')
    .addStringOption(option =>
        option.setName('type')
            .setDescription('The type of leaderboard to view')
            .setRequired(true)
            .addChoices(
                { name: 'KitMap', value: 'KitMap' },
                { name: 'Inferno', value: 'Inferno' }
            )
    );

export async function execute(interaction: any) {
    try {
        const type = interaction.options.getString('type') as LeaderboardType;
        
        // Refresh the leaderboards before displaying
        await leaderboardService.refreshAllLeaderboards();
        
        const embed = leaderboardService.createLeaderboardEmbed(type);
        
        await interaction.reply({ embeds: [embed] });
        
    } catch (error) {
        console.error('[LeaderboardCommand] Error:', error);
        sentryService.captureException(error as Error, {
            context: 'leaderboard_command',
            user_id: interaction.user.id,
            guild_id: interaction.guildId
        });
        
        await interaction.reply({ 
            content: '❌ Failed to load leaderboard. Please try again later.',
            ephemeral: true 
        });
    }
}
