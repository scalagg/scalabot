import {
    StringSelectMenuInteraction,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    TextChannel,
    GuildMember
} from 'discord.js';
import { ticketService } from '../services/TicketService';
import { serverUtils } from '../utils/ServerUtils';
import { TicketCategory } from '../models/Ticket';

export async function handleTicketTransfer(interaction: StringSelectMenuInteraction) {
    try {
        // Defer reply immediately to prevent interaction timeout
        await interaction.deferReply({ ephemeral: true });

        const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
        if (!ticket) {
            await interaction.editReply({ 
                content: '❌ Ticket not found'
            });
            return;
        }

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

        // Check if user has permission to transfer tickets
        if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
            await interaction.editReply({
                content: '❌ You do not have permission to transfer tickets'
            });
            return;
        }

        switch (interaction.customId) {
            case 'transfer_category_select':
                await handleCategoryTransfer(interaction, ticket);
                break;
            default:
                await interaction.editReply({
                    content: '❌ Unknown transfer operation'
                });
        }

    } catch (error) {
        console.error('[TicketTransfer] Error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while processing the transfer'
        });
    }
}

async function handleCategoryTransfer(interaction: StringSelectMenuInteraction, ticket: any) {
    const newCategory = interaction.values[0] as TicketCategory;
    
    if (newCategory === ticket.category) {
        await interaction.editReply({
            content: '❌ Ticket is already in this category'
        });
        return;
    }

    try {
        // Transfer the ticket to the new category
        await ticketService.transferTicketCategory(
            ticket._id,
            newCategory,
            interaction.user.id,
            'Category transfer via command'
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('✅ Ticket Transferred Successfully')
            .setDescription(`Ticket #${ticket.ticketNumber} has been transferred to a new category.`)
            .addFields(
                { name: '📝 Ticket', value: `#${ticket.ticketNumber}`, inline: true },
                { name: '👤 Creator', value: `<@${ticket.userId}>`, inline: true },
                { name: '🔄 From', value: ticket.category, inline: true },
                { name: '➡️ To', value: newCategory, inline: true },
                { name: '🛡️ Transferred By', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({
            embeds: [embed]
        });

        // Send notification to the ticket channel
        if (interaction.channel instanceof TextChannel) {
            const notificationEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('🔄 Ticket Category Changed')
                .setDescription(`This ticket has been transferred to the **${newCategory}** category.`)
                .addFields(
                    { name: '🛡️ Transferred By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '🕒 Transferred At', value: new Date().toLocaleString(), inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await interaction.channel.send({
                embeds: [notificationEmbed]
            });
        }

    } catch (error) {
        console.error('[TicketTransfer] Error transferring category:', error);
        await interaction.editReply({
            content: `❌ Failed to transfer ticket: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
    }
}

export async function handleTransferButton(interaction: any) {
    try {
        await interaction.deferReply({ ephemeral: true });

        const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
        if (!ticket) {
            await interaction.editReply({ 
                content: '❌ Ticket not found'
            });
            return;
        }

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

        // Check if user has permission
        if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
            await interaction.editReply({
                content: '❌ You do not have permission to manage transfers'
            });
            return;
        }

        const [action, type] = interaction.customId.split('_').slice(1);

        switch (action) {
            case 'view':
                await handleViewTransferHistory(interaction, ticket);
                break;
            case 'remove':
                await handleRemoveStaff(interaction, ticket, type);
                break;
            default:
                await interaction.editReply({
                    content: '❌ Unknown transfer action'
                });
        }

    } catch (error) {
        console.error('[TicketTransfer] Error handling button:', error);
        await interaction.editReply({
            content: '❌ An error occurred while processing the action'
        });
    }
}

async function handleViewTransferHistory(interaction: any, ticket: any) {
    try {
        const transferHistory = await ticketService.getTicketTransferHistory(ticket._id);

        if (transferHistory.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('📋 Transfer History')
                .setDescription(`No transfer history found for ticket #${ticket.ticketNumber}`)
                .addFields(
                    { name: '📝 Current Category', value: ticket.category, inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await interaction.editReply({
                embeds: [embed]
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('📋 Transfer History')
            .setDescription(`Transfer history for ticket #${ticket.ticketNumber}`)
            .addFields(
                { name: '📝 Current Category', value: ticket.category, inline: true },
                { name: '🔄 Total Transfers', value: transferHistory.length.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Add transfer history (limit to last 5 transfers to avoid embed limits)
        const recentTransfers = transferHistory.slice(-5);
        const transferText = recentTransfers.map((transfer, index) => {
            const date = new Date(transfer.transferredAt).toLocaleDateString();
            const reason = transfer.reason ? ` - ${transfer.reason}` : '';
            return `${index + 1}. **${transfer.fromCategory}** → **${transfer.toCategory}**\n   By: <@${transfer.transferredBy}> on ${date}${reason}`;
        }).join('\n\n');

        embed.addFields({
            name: '🕒 Recent Transfers',
            value: transferText,
            inline: false
        });

        await interaction.editReply({
            embeds: [embed]
        });

    } catch (error) {
        console.error('[TicketTransfer] Error viewing transfer history:', error);
        await interaction.editReply({
            content: '❌ Failed to load transfer history'
        });
    }
}

async function handleRemoveStaff(interaction: any, ticket: any, staffId: string) {
    try {
        // Check if the user is trying to remove themselves or another staff member
        if (!serverUtils.hasManagerRole(interaction.member) && interaction.user.id !== staffId) {
            await interaction.editReply({
                content: '❌ You can only remove yourself from ticket assignments'
            });
            return;
        }

        await ticketService.removeStaffFromTicket(ticket._id, staffId);

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('👤 Staff Removed')
            .setDescription(`<@${staffId}> has been removed from ticket #${ticket.ticketNumber}`)
            .addFields(
                { name: '🛡️ Removed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: '📝 Ticket', value: `#${ticket.ticketNumber}`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({
            embeds: [embed]
        });

        // Send notification to the ticket channel
        if (interaction.channel instanceof TextChannel) {
            const notificationEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('warning'))
                .setTitle('👤 Staff Assignment Removed')
                .setDescription(`<@${staffId}> is no longer assigned to this ticket.`)
                .addFields(
                    { name: '🛡️ Removed By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await interaction.channel.send({
                embeds: [notificationEmbed]
            });
        }

    } catch (error) {
        console.error('[TicketTransfer] Error removing staff:', error);
        await interaction.editReply({
            content: `❌ Failed to remove staff: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
    }
}

