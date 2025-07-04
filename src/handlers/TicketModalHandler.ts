import { ModalSubmitInteraction, TextChannel } from 'discord.js';
import { ticketService } from '../services/TicketService';
import { verifyMinecraftUsername } from '../utils/minecraftUtils';
import { TicketCategory } from '../models/Ticket';

export async function handleModal(interaction: ModalSubmitInteraction) {
    try {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                ephemeral: true
            });
            return;
        }

        // Defer the reply immediately to prevent timeout
        await interaction.deferReply({ ephemeral: true });

        const rawCategory = interaction.customId.split('-')[1].toUpperCase();
        if (!Object.values(TicketCategory).includes(rawCategory as TicketCategory)) {
            await interaction.editReply({
                content: '❌ Invalid ticket category.'
            });
            return;
        }
        const category = rawCategory as TicketCategory;
        
        // Get all field values
        const fields = Object.fromEntries(
            interaction.fields.fields.map(field => [field.customId, field.value])
        );

        // If minecraft username is provided, verify it
        const minecraftUsername = fields['minecraft-username'];
        if (minecraftUsername) {
            const verification = await verifyMinecraftUsername(minecraftUsername);
            if (!verification.isValid) {
                await interaction.editReply({
                    content: `❌ Invalid Minecraft username: ${verification.error}`
                });
                return;
            }
            // Update the username to use correct capitalization
            fields['minecraft-username'] = verification.username!;
        }

        // Check ticket limits
        const serverTickets = await ticketService.getOpenTicketCount(interaction.guildId!);
        if (serverTickets >= 50) {
            await interaction.editReply({
                content: '❌ The server has reached the maximum number of open tickets (50). Please try again later.'
            });
            return;
        }

        const userTickets = await ticketService.getUserOpenTickets(interaction.user.id, interaction.guildId!);
        if (userTickets >= 2) {
            await interaction.editReply({
                content: '❌ You have reached the maximum number of open tickets (2). Please close some of your existing tickets first.'
            });
            return;
        }

        console.log('[TicketModal] Creating ticket with fields:', {
            category,
            fields,
            userId: interaction.user.id,
            guildId: interaction.guildId
        });

        try {
            // Create the ticket
            const ticket = await ticketService.createTicket({
                userId: interaction.user.id,
                guildId: interaction.guildId!,
                category,
                fields
            });

            console.log('[TicketModal] Ticket created successfully:', {
                ticketId: ticket._id?.toString(),
                channelId: ticket.channelId
            });

            await interaction.editReply({
                content: `✅ Your ticket has been created: <#${ticket.channelId}>`
            });

        } catch (error) {
            console.error('[TicketModal] Error creating ticket:', error);
            await interaction.editReply({
                content: '❌ An error occurred while creating your ticket. Please try again.'
            });
        }

    } catch (error) {
        console.error('[TicketModal] Error handling modal submission:', error);
        
        // Handle the case where the interaction might have already been replied to
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ An error occurred while creating your ticket. Please try again.'
                });
            } else {
                await interaction.reply({
                    content: '❌ An error occurred while creating your ticket. Please try again.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('[TicketModal] Error sending error response:', replyError);
        }
    }
} 