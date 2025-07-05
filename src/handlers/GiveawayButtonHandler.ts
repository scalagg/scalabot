import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { giveawayService } from '../services/GiveawayService';
import { serverUtils } from '../utils/ServerUtils';

export class GiveawayButtonHandler {
    public static async handle(interaction: ButtonInteraction) {
        const customId = interaction.customId;

        if (customId.startsWith('giveaway_join_')) {
            await this.handleJoin(interaction);
        } else if (customId.startsWith('giveaway_leave_')) {
            await this.handleLeave(interaction);
        }
    }

    private static async handleJoin(interaction: ButtonInteraction) {
        try {
            const messageId = interaction.customId.replace('giveaway_join_', '');
            const userId = interaction.user.id;

            console.log('[GiveawayButtonHandler] Join attempt:', {
                messageId,
                userId,
                customId: interaction.customId
            });

            // Check if giveaway exists and is active
            const giveaway = await giveawayService.getGiveawayById(messageId);
            if (!giveaway) {
                console.log('[GiveawayButtonHandler] Giveaway not found for messageId:', messageId);
                await interaction.reply({
                    content: '❌ This giveaway no longer exists.',
                    ephemeral: true
                });
                return;
            }

            if (giveaway.ended) {
                await interaction.reply({
                    content: '❌ This giveaway has already ended.',
                    ephemeral: true
                });
                return;
            }

            // Check if user is already participating
            const isParticipating = await giveawayService.isParticipating(messageId, userId);
            if (isParticipating) {
                await interaction.reply({
                    content: '❌ You are already participating in this giveaway!',
                    ephemeral: true
                });
                return;
            }

            // Add participant
            const success = await giveawayService.addParticipant(messageId, userId);
            if (!success) {
                await interaction.reply({
                    content: '❌ Failed to join the giveaway. Please try again.',
                    ephemeral: true
                });
                return;
            }

            // Update the giveaway message
            const updatedGiveaway = await giveawayService.getGiveawayById(messageId);
            if (updatedGiveaway) {
                const embed = giveawayService.createGiveawayEmbed(updatedGiveaway);
                const buttons = giveawayService.createGiveawayButtons(updatedGiveaway);
                
                await interaction.message.edit({
                    embeds: [embed],
                    components: [buttons]
                });
            }

            await interaction.reply({
                content: '✅ You have successfully joined the giveaway! Good luck! 🎉',
                ephemeral: true
            });

        } catch (error) {
            console.error('[GiveawayButtonHandler] Error handling join:', error);
            await interaction.reply({
                content: '❌ An error occurred while joining the giveaway. Please try again.',
                ephemeral: true
            });
        }
    }

    private static async handleLeave(interaction: ButtonInteraction) {
        try {
            const messageId = interaction.customId.replace('giveaway_leave_', '');
            const userId = interaction.user.id;

            // Check if giveaway exists and is active
            const giveaway = await giveawayService.getGiveawayById(messageId);
            if (!giveaway) {
                await interaction.reply({
                    content: '❌ This giveaway no longer exists.',
                    ephemeral: true
                });
                return;
            }

            if (giveaway.ended) {
                await interaction.reply({
                    content: '❌ This giveaway has already ended.',
                    ephemeral: true
                });
                return;
            }

            // Check if user is participating
            const isParticipating = await giveawayService.isParticipating(messageId, userId);
            if (!isParticipating) {
                await interaction.reply({
                    content: '❌ You are not participating in this giveaway.',
                    ephemeral: true
                });
                return;
            }

            // Remove participant
            const success = await giveawayService.removeParticipant(messageId, userId);
            if (!success) {
                await interaction.reply({
                    content: '❌ Failed to leave the giveaway. Please try again.',
                    ephemeral: true
                });
                return;
            }

            // Update the giveaway message
            const updatedGiveaway = await giveawayService.getGiveawayById(messageId);
            if (updatedGiveaway) {
                const embed = giveawayService.createGiveawayEmbed(updatedGiveaway);
                const buttons = giveawayService.createGiveawayButtons(updatedGiveaway);
                
                await interaction.message.edit({
                    embeds: [embed],
                    components: [buttons]
                });
            }

            await interaction.reply({
                content: '✅ You have left the giveaway.',
                ephemeral: true
            });

        } catch (error) {
            console.error('[GiveawayButtonHandler] Error handling leave:', error);
            await interaction.reply({
                content: '❌ An error occurred while leaving the giveaway. Please try again.',
                ephemeral: true
            });
        }
    }
} 