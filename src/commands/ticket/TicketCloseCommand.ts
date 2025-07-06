import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { ticketService } from '../../services/TicketService';
import { transcriptService } from '../../services/TranscriptService';

export const data = new SlashCommandBuilder()
    .setName('ticketclose')
    .setDescription('Close a ticket directly')
    .addSubcommand(subcommand =>
        subcommand
            .setName('channel')
            .setDescription('Close the ticket in the current channel')
            .addStringOption(option =>
                option
                    .setName('reason')
                    .setDescription('Reason for closing the ticket')
                    .setRequired(false)
                    .setMaxLength(500)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('user')
            .setDescription('Close all tickets for a specific user')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('User whose tickets to close')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option
                    .setName('reason')
                    .setDescription('Reason for closing the tickets')
                    .setRequired(false)
                    .setMaxLength(500)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('force')
            .setDescription('Force close all open tickets (use with caution)')
            .addStringOption(option =>
                option
                    .setName('reason')
                    .setDescription('Reason for closing all tickets')
                    .setRequired(false)
                    .setMaxLength(500)
            )
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

        if (subcommand === 'channel') {
            await closeChannelTicket(interaction);
        } else if (subcommand === 'user') {
            await closeUserTickets(interaction);
        } else if (subcommand === 'force') {
            await forceCloseAllTickets(interaction);
        }

    } catch (error) {
        console.error('[TicketClose] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function closeChannelTicket(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel) {
        await interaction.editReply({
            content: '❌ This command can only be used in a text channel.'
        });
        return;
    }

    const reason = interaction.options.getString('reason') || 'Closed by administrator';

    try {
        const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
        
        if (!ticket) {
            await interaction.editReply({
                content: '❌ This channel is not associated with a ticket.'
            });
            return;
        }

        if (ticket.status !== 'OPEN') {
            await interaction.editReply({
                content: `❌ This ticket is already ${ticket.status.toLowerCase()}.`
            });
            return;
        }

        // Close the ticket
        await ticketService.closeTicket(ticket._id!, 'CLOSED');

        // Create transcript
        if (interaction.channel.isTextBased()) {
            try {
                await transcriptService.saveTranscript(
                    interaction.channel,
                    interaction.user.id,
                    ticket,
                    reason
                );
            } catch (transcriptError) {
                console.error('[TicketClose] Error creating transcript:', transcriptError);
            }
        }

        // Send confirmation
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🔒 Ticket Closed')
            .setDescription(`Ticket #${ticket.ticketNumber} has been closed.`)
            .addFields(
                { name: '👤 Closed By', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: true },
                { name: '📅 Closed At', value: new Date().toLocaleString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });

        // Send message to the ticket channel
        if (interaction.channel.isTextBased()) {
            await interaction.channel.send({
                content: `🔒 This ticket has been closed by ${interaction.user.tag}.\n**Reason:** ${reason}`,
                embeds: [embed]
            });
        }

    } catch (error) {
        console.error('[TicketClose] Error closing channel ticket:', error);
        await interaction.editReply({
            content: '❌ Failed to close the ticket.'
        });
    }
}

async function closeUserTickets(interaction: ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Closed by administrator';

    try {
        // Get all open tickets for the user
        const userTickets = await ticketService.getUserTickets(targetUser.id, interaction.guildId!, ['OPEN']);
        
        if (userTickets.length === 0) {
            await interaction.editReply({
                content: `❌ ${targetUser.tag} has no open tickets.`
            });
            return;
        }

        let closedCount = 0;
        const closedTickets = [];

        for (const ticket of userTickets) {
            try {
                // Close the ticket
                await ticketService.closeTicket(ticket._id!, 'CLOSED');
                closedCount++;
                closedTickets.push(ticket);

                // Try to create transcript if channel exists
                const channel = await interaction.guild!.channels.fetch(ticket.channelId).catch(() => null);
                if (channel && channel.isTextBased()) {
                    try {
                        await transcriptService.saveTranscript(
                            channel,
                            interaction.user.id,
                            ticket,
                            reason
                        );
                    } catch (transcriptError) {
                        console.error('[TicketClose] Error creating transcript:', transcriptError);
                    }
                }
            } catch (error) {
                console.error(`[TicketClose] Error closing ticket ${ticket._id}:`, error);
            }
        }

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🔒 User Tickets Closed')
            .setDescription(`Closed ${closedCount} ticket(s) for ${targetUser.tag}`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '👤 Closed By', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: true },
                { name: '📊 Tickets Closed', value: `${closedCount}/${userTickets.length}`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (closedTickets.length > 0) {
            const ticketList = closedTickets.map(ticket => 
                `**#${ticket.ticketNumber}** - ${ticket.category} - <#${ticket.channelId}>`
            ).join('\n');
            
            embed.addFields({
                name: '📋 Closed Tickets',
                value: ticketList.length > 1024 ? ticketList.substring(0, 1021) + '...' : ticketList,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[TicketClose] Error closing user tickets:', error);
        await interaction.editReply({
            content: '❌ Failed to close user tickets.'
        });
    }
}

async function forceCloseAllTickets(interaction: ChatInputCommandInteraction) {
    const reason = interaction.options.getString('reason') || 'Force closed by administrator';

    try {
        // Get all open tickets
        const allTickets = await ticketService.getUserTickets('', interaction.guildId!, ['OPEN']);
        
        if (allTickets.length === 0) {
            await interaction.editReply({
                content: '📝 No open tickets found.'
            });
            return;
        }

        // Confirm the action
        const confirmEmbed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('⚠️ Confirm Force Close')
            .setDescription(`You are about to force close **${allTickets.length}** open tickets.\n\nThis action cannot be undone!`)
            .addFields(
                { name: '👤 Executed By', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: true },
                { name: '📊 Tickets to Close', value: allTickets.length.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({
            content: '⚠️ **WARNING:** This will close ALL open tickets. Please confirm this action.',
            embeds: [confirmEmbed]
        });

        // Wait a moment for the user to see the warning
        await new Promise(resolve => setTimeout(resolve, 2000));

        let closedCount = 0;
        const closedTickets = [];

        for (const ticket of allTickets) {
            try {
                // Close the ticket
                await ticketService.closeTicket(ticket._id!, 'CLOSED');
                closedCount++;
                closedTickets.push(ticket);

                // Try to create transcript if channel exists
                const channel = await interaction.guild!.channels.fetch(ticket.channelId).catch(() => null);
                if (channel && channel.isTextBased()) {
                    try {
                        await transcriptService.saveTranscript(
                            channel,
                            interaction.user.id,
                            ticket,
                            reason
                        );
                    } catch (transcriptError) {
                        console.error('[TicketClose] Error creating transcript:', transcriptError);
                    }
                }
            } catch (error) {
                console.error(`[TicketClose] Error closing ticket ${ticket._id}:`, error);
            }
        }

        const resultEmbed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🔒 Force Close Complete')
            .setDescription(`Successfully closed **${closedCount}** out of **${allTickets.length}** tickets.`)
            .addFields(
                { name: '👤 Executed By', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: true },
                { name: '📊 Success Rate', value: `${Math.round((closedCount / allTickets.length) * 100)}%`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({
            content: `✅ Force close operation completed!`,
            embeds: [resultEmbed]
        });

    } catch (error) {
        console.error('[TicketClose] Error force closing tickets:', error);
        await interaction.editReply({
            content: '❌ Failed to force close tickets.'
        });
    }
} 