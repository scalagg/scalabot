import { ButtonInteraction } from 'discord.js';
import { handleButton as handleVerifyButton } from '../commands/deployverify';
import { handleButton as handleTicketButton } from './TicketButtonHandler';

export async function handleButton(interaction: ButtonInteraction) {
    try {
        // Handle verification button
        if (interaction.customId === 'verify-button') {
            await handleVerifyButton(interaction);
            return;
        }

        // Handle ticket buttons
        if (interaction.customId.startsWith('ticket-')) {
            await handleTicketButton(interaction);
            return;
        }

        console.log('[ButtonHandler] Unknown button interaction:', interaction.customId);
    } catch (error) {
        console.error('[ButtonHandler] Error handling button interaction:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: '❌ An error occurred while processing your request.',
                ephemeral: true
            });
        }
    }
} 