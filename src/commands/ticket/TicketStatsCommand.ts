import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction,
    EmbedBuilder,
    PermissionFlagsBits,
    GuildMember
} from 'discord.js';
import { ticketService } from '../../services/TicketService';
import { serverUtils } from '../../utils/ServerUtils';



export const data = new SlashCommandBuilder()
    .setName('ticketstats')
    .setDescription('View ticket statistics for a staff member')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The staff member to view stats for')
            .setRequired(true)
    )
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) return;

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId));

    // Check if user has admin permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Admin role required.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
        await interaction.reply({
            content: '❌ Please provide a valid user.',
            ephemeral: true
        });
        return;
    }

    const stats = await ticketService.getStaffStats(targetUser.id, interaction.guild.id);

    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('primary'))
        .setTitle(`📊 Ticket Statistics for ${targetUser.tag}`)
        .addFields(
            { 
                name: 'Total Tickets Claimed', 
                value: stats.totalClaimed.toString(),
                inline: true 
            },
            { 
                name: 'Average Rating', 
                value: stats.averageRating > 0 
                    ? `⭐ ${stats.averageRating.toFixed(1)}/5.0`
                    : 'No ratings yet',
                inline: true 
            },
            { 
                name: 'Total Ratings Received', 
                value: stats.totalRatings.toString(),
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
} 