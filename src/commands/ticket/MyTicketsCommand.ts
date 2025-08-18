import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} from 'discord.js';
import { ticketService } from '../../services/TicketService';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('mytickets')
    .setDescription('View all tickets assigned to you');

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

    // Check if user has staff permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Staff role required.',
            ephemeral: true
        });
        return;
    }

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply({ ephemeral: true });

        // Get tickets assigned to this staff member
        const assignedTickets = await ticketService.getTicketsByAssignedStaff(interaction.user.id, interaction.guildId!);

        if (assignedTickets.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('📋 My Assigned Tickets')
                .setDescription('You are not currently assigned to any tickets.')
                .addFields(
                    { name: '👤 Staff Member', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '📊 Total Assigned', value: '0', inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await interaction.editReply({
                embeds: [embed]
            });
            return;
        }

        // Group tickets by category
        const ticketsByCategory = assignedTickets.reduce((acc, ticket) => {
            if (!acc[ticket.category]) {
                acc[ticket.category] = [];
            }
            acc[ticket.category].push(ticket);
            return acc;
        }, {} as Record<string, any[]>);

        // Create main embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('primary'))
            .setTitle('📋 My Assigned Tickets')
            .setDescription(`You are currently assigned to **${assignedTickets.length}** ticket(s).`)
            .addFields(
                { name: '👤 Staff Member', value: `<@${interaction.user.id}>`, inline: true },
                { name: '📊 Total Assigned', value: assignedTickets.length.toString(), inline: true },
                { name: '📅 Last Updated', value: new Date().toLocaleDateString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Add category breakdown
        const categoryBreakdown = Object.entries(ticketsByCategory)
            .map(([category, tickets]) => `${category}: **${tickets.length}**`)
            .join(' | ');

        embed.addFields({
            name: '📈 Category Breakdown',
            value: categoryBreakdown,
            inline: false
        });

        // Add recent tickets (last 5)
        const recentTickets = assignedTickets.slice(0, 5);
        const recentTicketsText = recentTickets.map(ticket => {
            const date = new Date(ticket.updatedAt).toLocaleDateString();
            const status = ticket.status === 'OPEN' ? '🟢' : '🔴';
            return `${status} **#${ticket.ticketNumber}** - ${ticket.category} (${date})`;
        }).join('\n');

        embed.addFields({
            name: '🕒 Recent Tickets',
            value: recentTicketsText,
            inline: false
        });

        // Create navigation buttons if there are many tickets
        const components: ActionRowBuilder<ButtonBuilder>[] = [];

        if (assignedTickets.length > 5) {
            const buttonRow = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`mytickets_view_all_${interaction.user.id}`)
                        .setLabel(`View All (${assignedTickets.length})`)
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📋'),
                    new ButtonBuilder()
                        .setCustomId(`mytickets_by_category_${interaction.user.id}`)
                        .setLabel('View by Category')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📂')
                );
            components.push(buttonRow);
        }

        await interaction.editReply({
            embeds: [embed],
            components: components.length > 0 ? components : undefined
        });

    } catch (error) {
        console.error('[MyTickets] Error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while fetching your assigned tickets.'
        });
    }
}

