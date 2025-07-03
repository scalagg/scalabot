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
            ephemeral: true
        });
        return;
    }

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
        ephemeral: true
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
    if (!interaction.guild || !interaction.channel) return;

    const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
    if (!ticket) return;

    switch (interaction.customId) {
        case 'ticket_close_confirm':
            await closeTicket(interaction, ticket._id!, false);
            break;
        case 'ticket_close_rating':
            await requestRating(interaction, ticket);
            break;
        case 'ticket_close_cancel':
            await interaction.update({
                content: 'Ticket closure cancelled.',
                components: []
            });
            break;
    }
}

async function closeTicket(interaction: ButtonInteraction, ticketId: ObjectId, wasRated: boolean) {
    const channel = interaction.channel as TextChannel;
    if (!channel) return;

    // Generate transcript
    const transcript = await generateTranscript(channel);

    // Send transcript to logs channel
    const logsChannel = await interaction.guild!.channels.fetch(config.ticketLogsChannelId) as TextChannel;
    if (logsChannel?.isTextBased()) {
        await logsChannel.send({
            content: `Ticket closed by ${interaction.user}\nTranscript:\n\`\`\`${transcript}\`\`\``
        });
    }

    // Delete the channel
    await channel.delete();

    // Update ticket status in database
    await ticketService.closeTicket(ticketId, wasRated ? 'rated' : 'unrated');
}

async function requestRating(interaction: ButtonInteraction, ticket: any) {
    const channel = interaction.channel as TextChannel;
    if (!channel?.isTextBased()) return;

    // Send rating message
    await channel.send({
        content: `<@${ticket.userId}>, please rate your experience with this ticket before it closes.`,
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

async function generateTranscript(channel: TextChannel): Promise<string> {
    const messages = await channel.messages.fetch({ limit: 100 });
    let transcript = `Ticket Transcript - ${channel.name}\n`;
    transcript += `Created at: ${channel.createdAt}\n\n`;

    messages.reverse().forEach(msg => {
        transcript += `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content}\n`;
        msg.embeds.forEach(embed => {
            transcript += `[Embed: ${embed.title || 'Untitled'}]\n`;
        });
        msg.attachments.forEach(attachment => {
            transcript += `[Attachment: ${attachment.url}]\n`;
        });
    });

    return transcript;
}

export async function handleRating(interaction: ButtonInteraction) {
    if (!interaction.guild || !interaction.channel) return;

    const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
    if (!ticket || ticket.status !== 'RATING') return;

    if (interaction.user.id !== ticket.userId) {
        await interaction.reply({
            content: '❌ Only the ticket creator can provide a rating.',
            ephemeral: true
        });
        return;
    }

    const rating = parseInt(interaction.customId.split('_')[2]);
    
    // Create modal for feedback
    const modal = new ModalBuilder()
        .setCustomId(`ticket_feedback_${rating}`)
        .setTitle('Provide Feedback');

    const feedbackInput = new TextInputBuilder()
        .setCustomId('feedback')
        .setLabel('Would you like to provide any additional feedback?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Optional feedback about your experience...');

    const row = new ActionRowBuilder<TextInputBuilder>()
        .addComponents(feedbackInput);

    modal.addComponents(row);
    await interaction.showModal(modal);
} 