import {
    ButtonInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextChannel,
    GuildMember,
    PermissionFlagsBits,
    MessageCreateOptions,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ComponentType,
    Message,
    APIButtonComponent,
    MessageActionRowComponentBuilder
} from 'discord.js';
import { ticketService } from '../services/TicketService';
import { ObjectId } from 'mongodb';
import { config } from '../config/config';

const ADMIN_ROLES = [
    'Admin',
    'Senior Admin',
    'System Admin',
    'Platform Admin',
    'Co-Owner',
    'Owner'
];

export async function handleTicketManagement(interaction: ButtonInteraction) {
    if (!interaction.guild || !interaction.channel || !('name' in interaction.channel)) {
        console.log('[TicketManagement] Missing guild or channel:', {
            hasGuild: !!interaction.guild,
            hasChannel: !!interaction.channel,
            channelType: interaction.channel?.type
        });
        return;
    }

    const channelName = interaction.channel.name;
    const buttonId = interaction.customId;

    // Only check for ticket channel if it's a management button
    const isManagementButton = ['ticket_claim', 'ticket_close', 'ticket_manage_users'].includes(buttonId);
    
    if (isManagementButton && !channelName?.startsWith('ticket-')) {
        console.log('[TicketManagement] Management command used in non-ticket channel:', {
            channelName,
            buttonId
        });
        await interaction.reply({
            content: '❌ Ticket management commands can only be used in ticket channels.',
            ephemeral: true
        });
        return;
    }

    // If it's a ticket creation button, let it through to the TicketButtonHandler
    if (buttonId.startsWith('ticket_') && ['general', 'staff', 'buycraft', 'punishments'].some(type => buttonId === `ticket_${type}`)) {
        return;
    }

    console.log('[TicketManagement] Looking up ticket for channel:', {
        channelId: interaction.channel.id,
        channelName: interaction.channel.name,
        guildId: interaction.guild.id,
        guildName: interaction.guild.name
    });

    const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
    
    console.log('[TicketManagement] Ticket lookup result:', {
        found: !!ticket,
        ticketDetails: ticket ? {
            id: ticket._id?.toString(),
            userId: ticket.userId,
            status: ticket.status,
            category: ticket.category,
            channelId: ticket.channelId
        } : null
    });

    if (!ticket) {
        console.log('[TicketManagement] No ticket found, sending error message');
        await interaction.reply({
            content: '❌ Could not find ticket information for this channel.',
            ephemeral: true
        });
        return;
    }

    switch (buttonId) {
        case 'ticket_claim':
            await handleClaim(interaction, ticket._id!);
            break;
        case 'ticket_close':
            await handleClose(interaction, ticket);
            break;
        case 'ticket_manage_users':
            await handleManageUsers(interaction, ticket._id!);
            break;
    }
}

async function handleClaim(interaction: ButtonInteraction, ticketId: ObjectId) {
    if (!interaction.member || !interaction.guild) return;
    const member = interaction.member as GuildMember;

    // Check if user has staff role
    const hasStaffRole = member.roles.cache.some(role => 
        ADMIN_ROLES.includes(role.name)
    );

    if (!hasStaffRole) {
        await interaction.reply({
            content: '❌ You do not have permission to claim tickets.',
            ephemeral: true
        });
        return;
    }

    const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
    if (!ticket) return;

    if (ticket.claimedBy) {
        if (ticket.claimedBy === interaction.user.id) {
            // Unclaim the ticket
            await ticketService.unclaimTicket(ticketId);
            await interaction.reply({
                content: `✅ Ticket unclaimed by ${interaction.user}`,
            });

            // Create new action row with updated button
            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_claim')
                        .setLabel('Claim')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🎫'),
                    new ButtonBuilder()
                        .setCustomId('ticket_close')
                        .setLabel('Close')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒'),
                    new ButtonBuilder()
                        .setCustomId('ticket_manage_users')
                        .setLabel('Manage Users')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('👥')
                );

            await interaction.message.edit({ components: [row] });
        } else {
            await interaction.reply({
                content: `❌ This ticket is already claimed by <@${ticket.claimedBy}>`,
                ephemeral: true
            });
        }
        return;
    }

    // Claim the ticket
    await ticketService.claimTicket(ticketId, interaction.user.id);
    await interaction.reply({
        content: `✅ Ticket claimed by ${interaction.user}`,
    });

    // Create new action row with updated button
    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_claim')
                .setLabel('Claim')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🎫'),
            new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Close')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒'),
            new ButtonBuilder()
                .setCustomId('ticket_manage_users')
                .setLabel('Manage Users')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('👥')
        );

    await interaction.message.edit({ components: [row] });
}

async function handleClose(interaction: ButtonInteraction, ticket: any) {
    if (!interaction.member || !interaction.guild) return;
    const member = interaction.member as GuildMember;

    // Check if user has permission to close
    const canClose = member.roles.cache.some(role => ADMIN_ROLES.includes(role.name)) ||
                    ticket.claimedBy === interaction.user.id ||
                    ticket.userId === interaction.user.id;

    if (!canClose) {
        await interaction.reply({
            content: '❌ You do not have permission to close this ticket.',
            flags: 1 << 6
        });
        return;
    }

    // Create confirmation buttons
    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_close_confirm')
                .setLabel('Close')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket_close_rating')
                .setLabel('Ask for rating')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('ticket_close_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.reply({
        content: 'What would you like to do with this ticket?',
        components: [row],
        flags: 1 << 6
    });
}

async function handleManageUsers(interaction: ButtonInteraction, ticketId: ObjectId) {
    if (!interaction.member || !interaction.guild) return;
    const member = interaction.member as GuildMember;

    const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
    if (!ticket) return;

    // Check if user has permission to manage users
    const canManage = member.roles.cache.some(role => ADMIN_ROLES.includes(role.name)) ||
                     ticket.claimedBy === interaction.user.id;

    if (!canManage) {
        await interaction.reply({
            content: '❌ You do not have permission to manage users in this ticket.',
            ephemeral: true
        });
        return;
    }

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_add_user')
                .setLabel('Add User')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('ticket_remove_user')
                .setLabel('Remove User')
                .setStyle(ButtonStyle.Danger)
        );

    await interaction.reply({
        content: 'What would you like to do?',
        components: [row],
        ephemeral: true
    });
}

export async function handleUserManagement(interaction: ButtonInteraction) {
    if (!interaction.guild) return;

    const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
    if (!ticket) return;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`ticket_${interaction.customId === 'ticket_add_user' ? 'add' : 'remove'}_user_select`)
        .setPlaceholder('Select a user')
        .setMaxValues(1);

    if (interaction.customId === 'ticket_add_user') {
        // Add all guild members to the select menu
        const members = await interaction.guild.members.fetch();
        members.forEach(member => {
            if (!ticket.additionalUsers.includes(member.id) && 
                member.id !== ticket.userId && 
                member.id !== ticket.claimedBy) {
                selectMenu.addOptions({
                    label: member.user.tag,
                    value: member.id
                });
            }
        });
    } else {
        // Add only additional users to the select menu
        for (const userId of ticket.additionalUsers) {
            const member = await interaction.guild.members.fetch(userId);
            selectMenu.addOptions({
                label: member.user.tag,
                value: member.id
            });
        }
    }

    const row = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(selectMenu);

    await interaction.reply({
        content: `Select a user to ${interaction.customId === 'ticket_add_user' ? 'add to' : 'remove from'} the ticket:`,
        components: [row],
        ephemeral: true
    });
}

export async function handleUserSelect(interaction: StringSelectMenuInteraction) {
    if (!interaction.guild || !interaction.channel) return;

    const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
    if (!ticket) return;

    const userId = interaction.values[0];
    const isAdding = interaction.customId === 'ticket_add_user_select';

    if (isAdding) {
        await ticketService.addUserToTicket(ticket._id!, userId);
        await (interaction.channel as TextChannel).permissionOverwrites.create(userId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });
    } else {
        await ticketService.removeUserFromTicket(ticket._id!, userId);
        await (interaction.channel as TextChannel).permissionOverwrites.delete(userId);
    }

    const member = await interaction.guild.members.fetch(userId);
    await interaction.reply({
        content: `✅ Successfully ${isAdding ? 'added' : 'removed'} ${member.user.tag} ${isAdding ? 'to' : 'from'} the ticket.`,
        ephemeral: true
    });

    // Send public message in ticket
    await interaction.channel.send({
        content: `${interaction.user} has ${isAdding ? 'added' : 'removed'} ${member.user} ${isAdding ? 'to' : 'from'} the ticket.`
    });
}

export async function handleCloseConfirmation(interaction: ButtonInteraction) {
    console.log('[DEBUG] Close confirmation clicked:', interaction.customId);

    try {
        const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
        if (!ticket) {
            await interaction.reply({ 
                content: '❌ Ticket not found', 
                flags: 1 << 6 
            });
            return;
        }

        switch (interaction.customId) {
            case 'ticket_close_confirm':
                await interaction.reply({ 
                    content: '🔒 Closing ticket...', 
                    flags: 1 << 6 
                });
                await ticketService.closeTicket(ticket._id!, 'unrated');
                if (interaction.channel) {
                    await interaction.channel.delete();
                }
                break;

            case 'ticket_close_rating':
                await interaction.reply({ 
                    content: '⭐ Please rate your experience:', 
                    flags: 1 << 6 
                });
                if (interaction.channel && 'send' in interaction.channel) {
                    await interaction.channel.send({
                        content: `<@${ticket.userId}>, please rate your experience:`,
                        components: [
                            new ActionRowBuilder<ButtonBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('ticket_rate_good')
                                        .setLabel('👍 Good')
                                        .setStyle(ButtonStyle.Success),
                                    new ButtonBuilder()
                                        .setCustomId('ticket_rate_bad')
                                        .setLabel('👎 Bad')
                                        .setStyle(ButtonStyle.Danger)
                                )
                        ]
                    });
                }
                break;

            case 'ticket_close_cancel':
                await interaction.reply({ 
                    content: '✖️ Cancelled', 
                    flags: 1 << 6 
                });
                break;
        }
    } catch (error) {
        console.error('[ERROR] Close confirmation error:', error);
        await interaction.reply({ 
            content: '❌ An error occurred', 
            flags: 1 << 6 
        });
    }
}

export async function handleRating(interaction: ButtonInteraction) {
    try {
        const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
        if (!ticket) {
            await interaction.reply({ 
                content: '❌ Ticket not found', 
                flags: 1 << 6 
            });
            return;
        }

        // Only allow the ticket creator to rate
        if (interaction.user.id !== ticket.userId) {
            await interaction.reply({ 
                content: '❌ Only the ticket creator can rate the ticket', 
                flags: 1 << 6 
            });
            return;
        }

        const rating = interaction.customId === 'ticket_rate_good' ? 'good' : 'bad';
        
        await interaction.reply({ 
            content: `Thank you for your ${rating} rating! Closing ticket...`, 
            flags: 1 << 6 
        });
        
        // Close the ticket
        await ticketService.closeTicket(ticket._id!, 'rated');
        
        // Delete the channel after a short delay
        setTimeout(async () => {
            try {
                await interaction.channel?.delete();
            } catch (error) {
                console.error('[ERROR] Failed to delete channel:', error);
            }
        }, 2000);

    } catch (error) {
        console.error('[ERROR]', error);
        await interaction.reply({ 
            content: '❌ An error occurred', 
            flags: 1 << 6 
        });
    }
} 