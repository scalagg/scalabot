import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { giveawayService } from '../services/GiveawayService';
import { sentryService } from '../services/SentryService';
import { serverUtils } from '../utils/ServerUtils';

export class GiveawayButtonHandler {
    public static async handle(interaction: ButtonInteraction) {
        const customId = interaction.customId;

        if (customId.startsWith('giveaway_join_')) {
            await this.handleJoin(interaction);
        } else if (customId.startsWith('giveaway_leave_')) {
            await this.handleLeave(interaction);
        } else if (customId.startsWith('giveaway_chances_')) {
            await this.handleChances(interaction);
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
            sentryService.captureException(error as Error, {
                context: 'giveaway_join',
                user_id: interaction.user.id,
                guild_id: interaction.guildId,
                message_id: interaction.customId.replace('giveaway_join_', '')
            });
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

    private static async handleChances(interaction: ButtonInteraction) {
        try {
            const messageId = interaction.customId.replace('giveaway_chances_', '');
            const userId = interaction.user.id;

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

            const participantCount = giveaway.participants.length;
            const winnerCount = giveaway.winners;
            const isParticipating = giveaway.participants.includes(userId);
            let chance = 0;
            if (isParticipating && participantCount > 0) {
                chance = Math.min(1, winnerCount / participantCount) * 100;
            }

            const embed = new EmbedBuilder()
                .setColor(serverUtils.getColor('info'))
                .setTitle('🎲 Your Giveaway Chances')
                .addFields(
                    { name: '👥 Participants', value: participantCount.toString(), inline: true },
                    { name: '🏆 Winners', value: winnerCount.toString(), inline: true }
                )
                .setFooter(serverUtils.getFooter())
                .setTimestamp();

            if (isParticipating) {
                embed.addFields({
                    name: '📈 Your Chance',
                    value: `${chance.toFixed(2)}%`,
                    inline: true
                });
            } else {
                embed.addFields({
                    name: '❗ Not Participating',
                    value: 'Join the giveaway for a chance to win!',
                    inline: false
                });
            }

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        } catch (error) {
            console.error('[GiveawayButtonHandler] Error handling chances:', error);
            await interaction.reply({
                content: '❌ An error occurred while checking your chances.',
                ephemeral: true
            });
        }
    }
} 