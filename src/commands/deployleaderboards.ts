import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { leaderboardService, LeaderboardType } from '../services/LeaderboardService';
import { sentryService } from '../services/SentryService';
import { serverUtils } from '../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('deployleaderboards')
    .setDescription('Deploy leaderboard channels and messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: any) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const theme = serverUtils.getTheme();
        const info = serverUtils.getInfo();

        // Initialize leaderboard service
        await leaderboardService.startRefreshLoop();
        await leaderboardService.sendInitialMessages();

        for (const type of leaderboardService.getAllTypes()) {
            try {
                // Find or create leaderboard category
                let category = guild.channels.cache.find(
                    channel => channel.type === 4 && channel.name.toLowerCase().includes('leaderboards')
                );

                if (!category) {
                    category = await guild.channels.create({
                        name: '🏆 Leaderboards',
                        type: 4, // Category
                        permissionOverwrites: [
                            {
                                id: guild.roles.everyone.id,
                                deny: [PermissionFlagsBits.SendMessages],
                                allow: [PermissionFlagsBits.ViewChannel]
                            }
                        ]
                    });
                }

                // Find or create leaderboard channel
                let channel = guild.channels.cache.find(
                    ch => ch.parentId === category.id && ch.name.toLowerCase().includes(type.toLowerCase())
                );

                if (!channel) {
                    channel = await guild.channels.create({
                        name: `🏆${type}`,
                        type: 0, // Text channel
                        parent: category.id,
                        permissionOverwrites: [
                            {
                                id: guild.roles.everyone.id,
                                deny: [PermissionFlagsBits.SendMessages],
                                allow: [PermissionFlagsBits.ViewChannel]
                            }
                        ]
                    });
                }

                // Clear existing messages
                if (channel.messages.cache.size > 0) {
                    await channel.bulkDelete(channel.messages.cache.map(m => m.id));
                }

                // Create and send leaderboard embed
                const embed = leaderboardService.createLeaderboardEmbed(type);
                await channel.send({ embeds: [embed] });

                console.log(`[DeployLeaderboards] Created/updated leaderboard for ${type}`);

            } catch (error) {
                console.error(`[DeployLeaderboards] Error setting up ${type} leaderboard:`, error);
                sentryService.captureException(error as Error, {
                    context: 'deploy_leaderboard',
                    leaderboard_type: type,
                    guild_id: guild.id
                });
            }
        }

        await interaction.editReply('✅ Leaderboards deployed successfully!');

    } catch (error) {
        console.error('[DeployLeaderboards] Error:', error);
        sentryService.captureException(error as Error, {
            context: 'deploy_leaderboards_command',
            user_id: interaction.user.id,
            guild_id: interaction.guildId
        });
        
        await interaction.editReply('❌ Failed to deploy leaderboards. Please try again later.');
    }
}
