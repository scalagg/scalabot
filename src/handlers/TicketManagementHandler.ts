import {
    ButtonInteraction,
    EmbedBuilder,
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
    MessageActionRowComponentBuilder,
    ModalSubmitInteraction,
    Interaction,
    ActionRowBuilder
} from 'discord.js';
import { ticketService } from '../services/TicketService';
import { transcriptService } from '../services/TranscriptService';
import { sentryService } from '../services/SentryService';
import { ObjectId } from 'mongodb';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';

// Utility function to handle interactions with timeout
async function handleInteractionWithTimeout<T>(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    operation: () => Promise<T>,
    timeoutMs: number = 25000
): Promise<T> {
    return Promise.race([
        operation(),
        new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
        )
    ]);
}

export async function handleTicketManagement(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    try {
        // Defer reply immediately to prevent interaction timeout
        await interaction.deferReply({ ephemeral: true });
        
        const ticket = await handleInteractionWithTimeout(
            interaction,
            () => ticketService.getTicketByChannel(interaction.channel!.id),
            10000
        );
        
        if (!ticket) {
            await interaction.editReply({ 
                content: '❌ Ticket not found'
            });
            return;
        }

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

        // Check if user has permission to interact with this ticket
        if (!(interaction.member instanceof GuildMember)) {
            await interaction.editReply({
                content: '❌ You do not have permission to manage tickets'
            });
            return;
        }

        // For ticket close, allow anyone in the ticket (ticket creator or staff)
        // For other operations, require staff role
        const isCloseOperation = interaction.customId === 'ticket_close' || 
                                interaction.customId.startsWith('ticket_close_') ||
                                interaction.customId.startsWith('ticket_rate_');
        
        if (!isCloseOperation && !serverUtils.hasStaffRole(interaction.member)) {
            await interaction.editReply({
                content: '❌ You do not have permission to manage tickets'
            });
            return;
        }

        // For close operations, check if user is in the ticket
        if (isCloseOperation) {
            const hasStaffRole = serverUtils.hasStaffRole(interaction.member);
            const isTicketCreator = ticket.userId === interaction.user.id;
            
            // Allow if user is staff or ticket creator
            if (!hasStaffRole && !isTicketCreator) {
                await interaction.editReply({
                    content: '❌ Only staff members or the ticket creator can close tickets'
                });
                return;
            }
        }

        // Handle select menu interactions
        if (interaction.isStringSelectMenu()) {
            switch (interaction.customId) {
                case 'ticket_add_user_select':
                    const addUserId = interaction.values[0];
                    try {
                        await handleInteractionWithTimeout(
                            interaction,
                            () => ticketService.addUserToTicket(ticket._id!, addUserId),
                            15000
                        );

                        // Send ephemeral confirmation
                        await interaction.editReply({
                            content: 'The user was successfully added to the ticket.'
                        });

                        // Send public announcement
                        if (interaction.channel instanceof TextChannel) {
                            await interaction.channel.send({
                                content: `<@${addUserId}> has been added to the ticket.`
                            });
                        }
                    } catch (error) {
                        console.error('[TicketManagement] Error adding user to ticket:', error);
                        try {
                            sentryService.captureException(error as Error, {
                                context: 'ticket_add_user',
                                user_id: interaction.user.id,
                                guild_id: interaction.guildId,
                                ticket_id: ticket._id?.toString(),
                                target_user_id: addUserId
                            });
                        } catch (sentryError) {
                            console.error('Failed to capture error in Sentry:', sentryError);
                        }
                        await interaction.editReply({
                            content: `❌ Failed to add user: ${error instanceof Error ? error.message : 'Unknown error'}`
                        });
                    }
                    return;

                case 'ticket_remove_user_select':
                    const removeUserId = interaction.values[0];
                    try {
                        await handleInteractionWithTimeout(
                            interaction,
                            () => ticketService.removeUserFromTicket(ticket._id!, removeUserId),
                            15000
                        );

                        // Send ephemeral confirmation
                        await interaction.editReply({
                            content: 'The user was successfully removed from the ticket.'
                        });

                        // Send public announcement
                        if (interaction.channel instanceof TextChannel) {
                            await interaction.channel.send({
                                content: `<@${removeUserId}> has been removed from the ticket.`
                            });
                        }
                    } catch (error) {
                        console.error('[TicketManagement] Error removing user from ticket:', error);
                        try {
                            sentryService.captureException(error as Error, {
                                context: 'ticket_remove_user',
                                user_id: interaction.user.id,
                                guild_id: interaction.guildId,
                                ticket_id: ticket._id?.toString(),
                                target_user_id: removeUserId
                            });
                        } catch (sentryError) {
                            console.error('Failed to capture error in Sentry:', sentryError);
                        }
                        await interaction.editReply({
                            content: `❌ Failed to remove user: ${error instanceof Error ? error.message : 'Unknown error'}`
                        });
                    }
                    return;
            }
        }

        // Handle button interactions
        switch (interaction.customId) {
            case 'ticket_claim':
                // Check if ticket is already claimed
                if (ticket.claimedBy) {
                    // If claimed by someone else, only managers can take over
                    if (ticket.claimedBy !== interaction.user.id && !serverUtils.hasManagerRole(interaction.member)) {
                        await interaction.editReply({
                            content: '❌ This ticket is already claimed by someone else'
                        });
                        return;
                    }
                    // If claimed by the same person, unclaim it
                    if (ticket.claimedBy === interaction.user.id) {
                        await ticketService.unclaimTicket(ticket._id!);
                        const unclaimEmbed = new EmbedBuilder()
                            .setColor(serverUtils.getColor('warning'))
                            .setDescription(`🔓 <@${interaction.user.id}> has unclaimed this ticket.`)
                            .setFooter(serverUtils.getFooter());

                        await interaction.editReply({
                            embeds: [unclaimEmbed]
                        });
                        return;
                    }
                }

                // Claim the ticket
                await ticketService.claimTicket(ticket._id!, interaction.user.id);
                const claimEmbed = new EmbedBuilder()
                    .setTitle(':pushpin: This ticket has been claimed.')
                    .setColor(serverUtils.getColor('success'))
                    .setDescription(`✅ <@${interaction.user.id}> has claimed your ticket, they will be helping your ticket.`)
                    .setFooter(serverUtils.getFooter());

                    // ping ticket creator and send claim embed
                await interaction.editReply({
                    embeds: [claimEmbed],
                    content: `<@${ticket.userId}>`
                });
                break;

            case 'ticket_close':
                // Check if ticket is claimed
                const isUnclaimed = !ticket.claimedBy;
                
                const closeRow = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('ticket_close_with_rating')
                            .setLabel('Close with Rating')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId('ticket_close_no_rating')
                            .setLabel('Close without Rating')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('ticket_close_cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Danger)
                    );

                const warningEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('warning'))
                    .setDescription('🔒 How would you like to close this ticket?\n\n' +
                        (isUnclaimed ? 
                        "⚠️ The ticket hasn't been claimed by anyone yet, so no one will get a review from it.\n" +
                        "You can claim this ticket before closing it to get a review from the ticket author."
                        : "✨ Closing with rating will ask the ticket creator to rate their experience.\n" +
                        "❌ Closing without rating will close the ticket immediately."))
                    .setFooter(serverUtils.getFooter());

                await interaction.editReply({
                    embeds: [warningEmbed],
                    components: [closeRow]
                });
                break;

            case 'ticket_manage_users':
                // Check if user has permission to manage users
                if (!serverUtils.hasAdminOrHigherRole(interaction.member) && 
                    ticket.claimedBy !== interaction.user.id) {
                    await interaction.editReply({
                        content: '❌ Only the staff member who claimed the ticket or administrators can manage users'
                    });
                    return;
                }

                const manageUsersEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('primary'))
                    .setTitle('🔧 What do you want to do?')
                    .setDescription('Select an action to manage users in this ticket.')
                    .setFooter(serverUtils.getFooter());

                const manageRow = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('ticket_add_user')
                            .setLabel('Add User')
                            .setEmoji('➕')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId('ticket_remove_user')
                            .setLabel('Remove User')
                            .setEmoji('➖')
                            .setStyle(ButtonStyle.Danger)
                    );

                await interaction.editReply({
                    embeds: [manageUsersEmbed],
                    components: [manageRow]
                });
                break;

            case 'ticket_add_user':
                // Show modal to add user
                const addUserModal = new ModalBuilder()
                    .setCustomId('ticket_add_user_modal')
                    .setTitle('Add User to Ticket');

                const userInput = new TextInputBuilder()
                    .setCustomId('user_id')
                    .setLabel('User ID or @mention')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter user ID or @mention')
                    .setRequired(true);

                addUserModal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(userInput)
                );

                await interaction.showModal(addUserModal);
                break;

            case 'ticket_remove_user':
                // Get available users for this ticket
                const availableUsers = await ticketService.getAvailableUsersForTicket(interaction.guildId!, ticket);
                
                if (availableUsers.length === 0) {
                                    await interaction.editReply({
                    content: '❌ No users available to remove from this ticket.'
                });
                    return;
                }

                const removeUserSelect = new StringSelectMenuBuilder()
                    .setCustomId('ticket_remove_user_select')
                    .setPlaceholder('Select a user to remove')
                    .addOptions(
                        availableUsers.map(user => ({
                            label: user.user.username,
                            value: user.id,
                            description: `Remove ${user.user.username} from the ticket`
                        }))
                    );

                const removeUserRow = new ActionRowBuilder<StringSelectMenuBuilder>()
                    .addComponents(removeUserSelect);

                await interaction.editReply({
                    content: 'Select a user to remove from the ticket:',
                    components: [removeUserRow]
                });
                break;

            case 'ticket_transfer_quick':
                // Create quick transfer category selection
                const quickTransferSelect = new StringSelectMenuBuilder()
                    .setCustomId('transfer_category_select')
                    .setPlaceholder('Select new category for this ticket')
                    .addOptions(
                        {
                            label: 'Staff Application',
                            description: 'Transfer to staff application category',
                            value: 'STAFF_APPLICATION',
                            emoji: '👑'
                        },
                        {
                            label: 'Media Application',
                            description: 'Transfer to media application category',
                            value: 'MEDIA_APPLICATION',
                            emoji: '📸'
                        },
                        {
                            label: 'Punishment Appeal',
                            description: 'Transfer to punishment appeal category',
                            value: 'PUNISHMENT_APPEAL',
                            emoji: '⚖️'
                        },
                        {
                            label: 'Bug Report',
                            description: 'Transfer to bug report category',
                            value: 'BUG_REPORT',
                            emoji: '🐛'
                        },
                        {
                            label: 'Tebex Support',
                            description: 'Transfer to Tebex support category',
                            value: 'TEBEX_SUPPORT',
                            emoji: '🛒'
                        },
                        {
                            label: 'Head Staff Support',
                            description: 'Transfer to head staff support category',
                            value: 'HEAD_STAFF_SUPPORT',
                            emoji: '👨‍💼'
                        },
                        {
                            label: 'General Support',
                            description: 'Transfer to general support category',
                            value: 'GENERAL_SUPPORT',
                            emoji: '🌐'
                        },
                        {
                            label: 'Other',
                            description: 'Transfer to other category',
                            value: 'OTHER',
                            emoji: '❓'
                        }
                    );

                const quickTransferRow = new ActionRowBuilder<StringSelectMenuBuilder>()
                    .addComponents(quickTransferSelect);

                const quickTransferEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('info'))
                    .setTitle('🔄 Quick Transfer')
                    .setDescription(`Current category: **${ticket.category}**\n\nSelect the new category for this ticket.`)
                    .addFields(
                        { name: '📝 Ticket', value: `#${ticket.ticketNumber}`, inline: true },
                        { name: '👤 Creator', value: `<@${ticket.userId}>`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter(serverUtils.getFooter());

                await interaction.editReply({
                    embeds: [quickTransferEmbed],
                    components: [quickTransferRow]
                });
                break;
        }

    } catch (error) {
        console.error('[TicketManagement] Error handling interaction:', error);
        
        // Check if interaction has already been replied to
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred while processing your request.',
                    flags: 1 << 6
                });
            } else if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ An error occurred while processing your request.'
                });
            } else {
                await interaction.followUp({
                    content: '❌ An error occurred while processing your request.',
                    flags: 1 << 6
                });
            }
        } catch (replyError) {
            console.error('[TicketManagement] Failed to send error reply:', replyError);
        }
    }
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

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

        switch (interaction.customId) {
            case 'ticket_close_with_rating':
                if (interaction.channel instanceof TextChannel) {
                    // Ask for rating
                    const ratingEmbed = new EmbedBuilder()
                        .setColor(serverUtils.getColor('primary'))
                        .setTitle('⭐ Rate Your Experience')
                        .setDescription(`<@${ticket.userId}>, please rate your experience with this ticket:`)
                        .setFooter(serverUtils.getFooter());

                    const ratingRow = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('ticket_rate_5')
                                .setLabel('⭐⭐⭐⭐⭐')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId('ticket_rate_4')
                                .setLabel('⭐⭐⭐⭐')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId('ticket_rate_3')
                                .setLabel('⭐⭐⭐')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId('ticket_rate_2')
                                .setLabel('⭐⭐')
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId('ticket_rate_1')
                                .setLabel('⭐')
                                .setStyle(ButtonStyle.Danger)
                        );

                    await interaction.reply({
                        embeds: [ratingEmbed],
                        components: [ratingRow]
                    });
                }
                break;

            case 'ticket_close_no_rating':
                await interaction.reply({ 
                    content: 'Closing ticket without rating...',
                    flags: 1 << 6 
                });

                if (interaction.channel instanceof TextChannel) {
                    // Save transcript before closing
                    await transcriptService.saveTranscript(
                        interaction.channel,
                        interaction.user.id,
                        ticket
                    );
                    
                    // Close ticket in database
                    await ticketService.closeTicket(ticket._id!, 'unrated');
                    
                    // Send closing message and delete channel
                    const closingEmbed = new EmbedBuilder()
                        .setColor(serverUtils.getColor('primary'))
                        .setDescription('🔒 The ticket has been closed!\nThis channel will be deleted in 5 seconds.')
                        .setFooter(serverUtils.getFooter());

                    await interaction.channel.send({
                        embeds: [closingEmbed]
                    });
                    setTimeout(async () => {
                        try {
                            await interaction.channel?.delete();
                        } catch (error) {
                            console.error('[ERROR] Failed to delete channel:', error);
                        }
                    }, 5000);
                }
                break;

            case 'ticket_close_cancel':
                await interaction.reply({ 
                    content: 'The ticket will not be closed.',
                    flags: 1 << 6 
                });
                break;
        }
    } catch (error) {
        console.error('[ERROR] Close confirmation error:', error);
        
        // Check if interaction has already been replied to
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ An error occurred', 
                    flags: 1 << 6 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ An error occurred'
                });
            } else {
                await interaction.followUp({ 
                    content: '❌ An error occurred', 
                    flags: 1 << 6 
                });
            }
        } catch (replyError) {
            console.error('[TicketManagement] Failed to send error reply:', replyError);
        }
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

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

        // Only allow the ticket creator to rate
        if (interaction.user.id !== ticket.userId) {
            await interaction.reply({ 
                content: '❌ Only the ticket creator can rate the ticket', 
                flags: 1 << 6 
            });
            return;
        }

        // Extract rating from button ID (e.g., ticket_rate_5 -> 5)
        const rating = parseInt(interaction.customId.split('_').pop() || '0');
        
        // Create feedback modal
        const modal = new ModalBuilder()
            .setCustomId(`ticket_feedback_${rating}`)
            .setTitle('Ticket Feedback');

        const feedbackInput = new TextInputBuilder()
            .setCustomId('feedback')
            .setLabel('Would you like to add any feedback? (Optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Enter your feedback here...')
            .setRequired(false)
            .setMaxLength(1000);

        const actionRow = new ActionRowBuilder<TextInputBuilder>()
            .addComponents(feedbackInput);

        modal.addComponents(actionRow);

        await interaction.showModal(modal);

    } catch (error) {
        console.error('[ERROR]', error);
        
        // Check if interaction has already been replied to
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ An error occurred', 
                    flags: 1 << 6 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ An error occurred'
                });
            } else {
                await interaction.followUp({ 
                    content: '❌ An error occurred', 
                    flags: 1 << 6 
                });
            }
        } catch (replyError) {
            console.error('[TicketManagement] Failed to send error reply:', replyError);
        }
    }
}

export async function handleFeedback(interaction: ModalSubmitInteraction) {
    try {
        const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
        if (!ticket) {
            await interaction.reply({ 
                content: '❌ Ticket not found', 
                flags: 1 << 6 
            });
            return;
        }

        // Set server type based on guild ID
        serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

        // Extract rating from modal ID (e.g., ticket_feedback_5 -> 5)
        const rating = parseInt(interaction.customId.split('_').pop() || '0');
        const feedback = interaction.fields.getTextInputValue('feedback');
        
        await interaction.reply({ 
            content: `Thank you for your ${rating}-star rating${feedback ? ' and feedback' : ''}! Closing ticket...`, 
            flags: 1 << 6 
        });
        
        if (interaction.channel instanceof TextChannel) {
            // Save transcript before closing
            await transcriptService.saveTranscript(
                interaction.channel,
                interaction.user.id,
                ticket,
                `Closed with ${rating}-star rating`
            );
            
            // Close the ticket with rating and feedback
            await ticketService.closeTicket(ticket._id!, 'rated', rating, feedback || undefined);
            
            // Send closing message and delete after delay
            const closingEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('primary'))
                .setDescription('🔒 The ticket has been closed!\nThis channel will be deleted in 5 seconds.')
                .setFooter(serverUtils.getFooter());

            await interaction.channel.send({
                embeds: [closingEmbed]
            });
            setTimeout(async () => {
                try {
                    await interaction.channel?.delete();
                } catch (error) {
                    console.error('[ERROR] Failed to delete channel:', error);
                }
            }, 5000);
        }

    } catch (error) {
        console.error('[ERROR]', error);
        await interaction.reply({ 
            content: '❌ An error occurred', 
            flags: 1 << 6 
        });
    }
}

export async function handleAddUserModal(interaction: ModalSubmitInteraction) {
    try {
        // Get the initial ticket to verify it exists
        const ticket = await ticketService.getTicketByChannel(interaction.channel!.id);
        if (!ticket) {
            await interaction.reply({ 
                content: '❌ Ticket not found', 
                flags: 1 << 6 
            });
            return;
        }

        // Get the user input
        const userInput = interaction.fields.getTextInputValue('user_id');

        // Try to find the user
        let member;
        if (/^\d+$/.test(userInput)) {
            // Input is a user ID
            try {
                member = await interaction.guild?.members.fetch(userInput);
            } catch (error) {
                member = null;
            }
        } else {
            // Input is a username
            const members = await interaction.guild?.members.fetch();
            member = members?.find(m => 
                m.user.username.toLowerCase() === userInput.toLowerCase() ||
                m.displayName.toLowerCase() === userInput.toLowerCase()
            );
        }

        if (!member) {
            await interaction.reply({
                content: '❌ User not found. Please check the username or ID and try again.',
                flags: 1 << 6
            });
            return;
        }

        // Add the user to the ticket
        try {
            await ticketService.addUserToTicket(ticket._id!, member.id);

            // Send ephemeral confirmation
            await interaction.reply({
                content: 'The user was successfully added to the ticket.',
                flags: 1 << 6
            });

            // Send public announcement
            if (interaction.channel instanceof TextChannel) {
                await interaction.channel.send({
                    content: `<@${member.id}> has been added to the ticket.`
                });
            }
        } catch (error) {
            await interaction.reply({
                content: `❌ Failed to add user: ${error instanceof Error ? error.message : 'Unknown error'}`,
                flags: 1 << 6
            });
        }
    } catch (error) {
        console.error('[ERROR] Add user modal error:', error);
        await interaction.reply({ 
            content: '❌ An error occurred while processing your request.', 
            flags: 1 << 6 
        });
    }
} 