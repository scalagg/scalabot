import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    EmbedBuilder
} from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';
import { giveawayService } from '../services/GiveawayService';

export const data = new SlashCommandBuilder()
    .setName('givestats')
    .setDescription('View your giveaway statistics')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('User to check stats for (defaults to yourself)')
            .setRequired(false)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({
            content: '❌ This command can only be used in a server.',
            ephemeral: true
        });
        return;
    }

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    try {
        await interaction.deferReply({ ephemeral: true });

        // Get all giveaways for this guild
        const allGiveaways = await giveawayService.getGiveawaysByGuild(interaction.guildId!);
        
        // Calculate statistics
        let totalParticipated = 0;
        let totalWon = 0;
        let activeParticipations = 0;
        const wonGiveaways: string[] = [];
        const participatedGiveaways: string[] = [];

        for (const giveaway of allGiveaways) {
            const isParticipating = giveaway.participants.includes(userId);
            const hasWon = giveaway.winnerIds?.includes(userId) || false;

            if (isParticipating) {
                totalParticipated++;
                participatedGiveaways.push(giveaway.prize);

                if (!giveaway.ended) {
                    activeParticipations++;
                }
            }

            if (hasWon) {
                totalWon++;
                wonGiveaways.push(giveaway.prize);
            }
        }

        const winRate = totalParticipated > 0 ? ((totalWon / totalParticipated) * 100).toFixed(1) : '0.0';

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('🎉 Giveaway Statistics')
            .setDescription(`Statistics for ${targetUser.tag}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '📊 Total Participated', value: totalParticipated.toString(), inline: true },
                { name: '🏆 Total Won', value: totalWon.toString(), inline: true },
                { name: '📈 Win Rate', value: `${winRate}%`, inline: true },
                { name: '⏳ Active Participations', value: activeParticipations.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Add recent participations
        if (participatedGiveaways.length > 0) {
            const recentParticipations = participatedGiveaways.slice(-5).reverse();
            embed.addFields({
                name: '📝 Recent Participations',
                value: recentParticipations.map(prize => `• ${prize}`).join('\n'),
                inline: false
            });
        }

        // Add recent wins
        if (wonGiveaways.length > 0) {
            const recentWins = wonGiveaways.slice(-5).reverse();
            embed.addFields({
                name: '🎊 Recent Wins',
                value: recentWins.map(prize => `• ${prize}`).join('\n'),
                inline: false
            });
        }

        // Add motivational message based on stats
        if (totalParticipated === 0) {
            embed.addFields({
                name: '💡 Tip',
                value: 'You haven\'t participated in any giveaways yet! Join some to start building your stats!',
                inline: false
            });
        } else if (totalWon === 0) {
            embed.addFields({
                name: '💡 Tip',
                value: 'Keep participating! Your luck will turn around soon! 🍀',
                inline: false
            });
        } else if (parseFloat(winRate) > 20) {
            embed.addFields({
                name: '🎯 Amazing!',
                value: 'You have an excellent win rate! Keep up the great luck!',
                inline: false
            });
        } else {
            embed.addFields({
                name: '💪 Keep Going!',
                value: 'Every participation increases your chances of winning!',
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[GiveStats] Error getting giveaway stats:', error);
        await interaction.editReply({
            content: '❌ An error occurred while getting giveaway statistics. Please try again.'
        });
    }
} 