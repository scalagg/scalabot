import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { ticketService } from '../../services/TicketService';
import { mongoService } from '../../services/MongoService';

export const data = new SlashCommandBuilder()
    .setName('ticketdebug')
    .setDescription('Debug ticket system information')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Show overall ticket system status')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('user')
            .setDescription('Show ticket information for a specific user')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('User to check tickets for')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('channel')
            .setDescription('Show ticket information for current channel')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List all open tickets')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

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

    // Check if user has admin permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Admin role required.',
            ephemeral: true
        });
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
        await interaction.deferReply({ ephemeral: true });

        if (subcommand === 'status') {
            await showStatus(interaction);
        } else if (subcommand === 'user') {
            await showUserTickets(interaction);
        } else if (subcommand === 'channel') {
            await showChannelTicket(interaction);
        } else if (subcommand === 'list') {
            await listAllTickets(interaction);
        }

    } catch (error) {
        console.error('[TicketDebug] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    try {
        // Get ticket statistics
        const openTickets = await ticketService.getOpenTicketCount(interaction.guildId!);
        const allTickets = await ticketService.getUserTickets('', interaction.guildId!, ['OPEN', 'CLOSED', 'RATING']);
        
        // Get MongoDB connection status
        const mongoConnected = mongoService.isConnectedToMongo();
        
        // Get ticket categories
        const categories = ['STAFF_APPLICATION', 'MEDIA_APPLICATION', 'PUNISHMENT_APPEAL', 'BUG_REPORT', 'TEBEX_SUPPORT', 'HEAD_STAFF_SUPPORT', 'GENERAL_SUPPORT', 'OTHER'];
        const categoryStats = await Promise.all(
            categories.map(async (category) => {
                const categoryTickets = allTickets.filter(ticket => ticket.category === category);
                return {
                    category,
                    count: categoryTickets.length,
                    open: categoryTickets.filter(t => t.status === 'OPEN').length
                };
            })
        );

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('🔧 Ticket System Debug Status')
            .addFields(
                { 
                    name: '📊 Overall Statistics', 
                    value: `**Open Tickets:** ${openTickets}\n**Total Tickets:** ${allTickets.length}\n**MongoDB Connected:** ${mongoConnected ? '✅' : '❌'}`, 
                    inline: false 
                }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Import category helper functions
        const { getCategoryDisplayName } = await import('../../models/Ticket');
        
        // Add category statistics
        const categoryText = categoryStats.map(stat => 
            `${getCategoryDisplayName(stat.category as any)}: ${stat.open}/${stat.count}`
        ).join('\n');
        
        embed.addFields({
            name: '📂 Category Breakdown',
            value: categoryText || 'No tickets found',
            inline: false
        });

        // Add system health indicators
        const healthIndicators = [];
        if (openTickets < 50) healthIndicators.push('✅ Ticket limit not reached');
        else healthIndicators.push('⚠️ Ticket limit reached (50)');
        
        if (mongoConnected) healthIndicators.push('✅ Database connected');
        else healthIndicators.push('❌ Database disconnected');
        
        embed.addFields({
            name: '🏥 System Health',
            value: healthIndicators.join('\n'),
            inline: false
        });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[TicketDebug] Error showing status:', error);
        await interaction.editReply({
            content: '❌ Failed to get ticket system status.'
        });
    }
}

async function showUserTickets(interaction: ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user', true);
    
    try {
        // Get all tickets for the user
        const userTickets = await ticketService.getUserTickets(targetUser.id, interaction.guildId!, ['OPEN', 'CLOSED', 'RATING']);
        
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle(`🎫 Ticket Debug - ${targetUser.tag}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🆔 User ID', value: targetUser.id, inline: true },
                { name: '📊 Total Tickets', value: userTickets.length.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Group tickets by status
        const openTickets = userTickets.filter(t => t.status === 'OPEN');
        const closedTickets = userTickets.filter(t => t.status === 'CLOSED');
        const ratingTickets = userTickets.filter(t => t.status === 'RATING');

        embed.addFields(
            { name: '🟢 Open Tickets', value: openTickets.length.toString(), inline: true },
            { name: '🔴 Closed Tickets', value: closedTickets.length.toString(), inline: true },
            { name: '⭐ Rating Tickets', value: ratingTickets.length.toString(), inline: true }
        );

        // Show recent tickets
        const recentTickets = userTickets.slice(0, 5);
        if (recentTickets.length > 0) {
            const recentText = recentTickets.map(ticket => 
                `**${ticket.status}** - ${getCategoryDisplayName(ticket.category as any)} - <#${ticket.channelId}> - ${new Date(ticket.createdAt).toLocaleDateString()}`
            ).join('\n');
            
            embed.addFields({
                name: '📝 Recent Tickets',
                value: recentText,
                inline: false
            });
        }

        // Show open ticket details
        if (openTickets.length > 0) {
            const openText = openTickets.map(ticket => 
                `**${getCategoryDisplayName(ticket.category as any)}** - <#${ticket.channelId}> - ${ticket.claimedBy ? `Claimed by <@${ticket.claimedBy}>` : 'Unclaimed'}`
            ).join('\n');
            
            embed.addFields({
                name: '🟢 Open Ticket Details',
                value: openText,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[TicketDebug] Error showing user tickets:', error);
        await interaction.editReply({
            content: '❌ Failed to get user ticket information.'
        });
    }
}

async function showChannelTicket(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel) {
        await interaction.editReply({
            content: '❌ This command can only be used in a text channel.'
        });
        return;
    }

    try {
        const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
        
        if (!ticket) {
            await interaction.editReply({
                content: '❌ This channel is not associated with a ticket.'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle(`🎫 Ticket Debug - Channel ${interaction.channel.name}`)
            .addFields(
                { name: '🆔 Ticket ID', value: ticket._id?.toString() || 'Unknown', inline: true },
                { name: '📝 Ticket Number', value: ticket.ticketNumber.toString(), inline: true },
                { name: '📂 Category', value: getCategoryDisplayName(ticket.category as any), inline: true },
                { name: '👤 Created By', value: `<@${ticket.userId}>`, inline: true },
                { name: '📅 Created', value: new Date(ticket.createdAt).toLocaleString(), inline: true },
                { name: '📊 Status', value: ticket.status, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (ticket.claimedBy) {
            embed.addFields({
                name: '📌 Claimed By',
                value: `<@${ticket.claimedBy}> at ${ticket.claimedAt ? new Date(ticket.claimedAt).toLocaleString() : 'Unknown'}`,
                inline: false
            });
        }

        if (ticket.closedBy) {
            embed.addFields({
                name: '🔒 Closed By',
                value: `<@${ticket.closedBy}> at ${ticket.closedAt ? new Date(ticket.closedAt).toLocaleString() : 'Unknown'}`,
                inline: false
            });
        }

        if (ticket.additionalUsers && ticket.additionalUsers.length > 0) {
            const additionalUsersText = ticket.additionalUsers.map(userId => `<@${userId}>`).join(', ');
            embed.addFields({
                name: '👥 Additional Users',
                value: additionalUsersText,
                inline: false
            });
        }

        if (ticket.metadata) {
            const metadataText = Object.entries(ticket.metadata)
                .map(([key, value]) => `**${key}:** ${value}`)
                .join('\n');
            
            if (metadataText) {
                embed.addFields({
                    name: '📋 Metadata',
                    value: metadataText.length > 1024 ? metadataText.substring(0, 1021) + '...' : metadataText,
                    inline: false
                });
            }
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[TicketDebug] Error showing channel ticket:', error);
        await interaction.editReply({
            content: '❌ Failed to get channel ticket information.'
        });
    }
}

async function listAllTickets(interaction: ChatInputCommandInteraction) {
    try {
        const allTickets = await ticketService.getUserTickets('', interaction.guildId!, ['OPEN', 'CLOSED', 'RATING']);
        const openTickets = allTickets.filter(t => t.status === 'OPEN');
        
        if (openTickets.length === 0) {
            await interaction.editReply({
                content: '📝 No open tickets found.'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('📋 All Open Tickets')
            .setDescription(`Found ${openTickets.length} open ticket(s)`)
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Group tickets by category
        const ticketsByCategory = openTickets.reduce((acc, ticket) => {
            if (!acc[ticket.category]) acc[ticket.category] = [];
            acc[ticket.category].push(ticket);
            return acc;
        }, {} as Record<string, typeof openTickets>);

        Object.entries(ticketsByCategory).forEach(([category, tickets]) => {
            const categoryText = tickets.map(ticket => 
                `**#${ticket.ticketNumber}** - <#${ticket.channelId}> - <@${ticket.userId}>${ticket.claimedBy ? ` (Claimed by <@${ticket.claimedBy}>)` : ''}`
            ).join('\n');
            
            embed.addFields({
                name: `${getCategoryDisplayName(category as any)} (${tickets.length})`,
                value: categoryText.length > 1024 ? categoryText.substring(0, 1021) + '...' : categoryText,
                inline: false
            });
        });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[TicketDebug] Error listing tickets:', error);
        await interaction.editReply({
            content: '❌ Failed to list tickets.'
        });
    }
} 