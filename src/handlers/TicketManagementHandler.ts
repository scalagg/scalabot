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
    MessageActionRowComponentBuilder,
    ModalSubmitInteraction
} from 'discord.js';
import { ticketService } from '../services/TicketService';
import { transcriptService } from '../services/TranscriptService';
import { ObjectId } from 'mongodb';
import { config } from '../config/config';
import { serverUtils } from '../utils/ServerUtils';

export async function handleTicketManagement(interaction: ButtonInteraction) {
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

        // Check if user has staff role
        if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
            await interaction.reply({
                content: '❌ You do not have permission to manage tickets',
                flags: 1 << 6
            });
            return;
        }

        switch (interaction.customId) {
            case 'ticket_claim':
                // Check if ticket is already claimed
                if (ticket.claimedBy) {
                    // If claimed by someone else, only managers can take over
                    if (ticket.claimedBy !== interaction.user.id && !serverUtils.hasManagerRole(interaction.member)) {
                        await interaction.reply({
                            content: '❌ This ticket is already claimed by someone else',
                            flags: 1 << 6
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

                        await interaction.reply({
                            embeds: [unclaimEmbed]
                        });
                        return;
                    }
                }

                // Claim the ticket
                await ticketService.claimTicket(ticket._id!, interaction.user.id);
                const claimEmbed = new EmbedBuilder()
                    .setColor(serverUtils.getColor('success'))
                    .setDescription(`✅ <@${interaction.user.id}> has claimed this ticket.`)
                    .setFooter(serverUtils.getFooter());

                await interaction.reply({
                    embeds: [claimEmbed]
                });
                break;

            case 'ticket_close':
                // Check if ticket is claimed
                const isUnclaimed = !ticket.claimedBy;
                
                const row = new ActionRowBuilder<ButtonBuilder>()
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

                await interaction.reply({
                    embeds: [warningEmbed],
                    components: [row],
                    flags: 1 << 6
                });
                break;

            // ... rest of the cases
        }
    } catch (error) {
        console.error('[ERROR] Ticket management error:', error);
        await interaction.reply({ 
            content: '❌ An error occurred', 
            flags: 1 << 6 
        });
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
                        components: [ratingRow],
                        flags: 1 << 6
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
        await interaction.reply({ 
            content: '❌ An error occurred', 
            flags: 1 << 6 
        });
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