import { ButtonInteraction } from 'discord.js';
import { handleButton as handleVerifyButton } from '../commands/deployverify';
import { handleTicketButton } from './TicketButtonHandler';

export async function handleButton(interaction: ButtonInteraction) {
    const { customId } = interaction;

    try {
        // Handle verification button
        if (customId === 'verify-button') {
            await handleVerifyButton(interaction);
            return;
        }

        // Handle ticket buttons
        if (customId.startsWith('ticket-')) {
            await handleTicketButton(interaction);
            return;
        }

        // Handle role menu buttons
        if (customId.startsWith('confirm_roles_')) {
            // This part of the code was removed as per the edit hint.
            // await handleConfirmRoles(interaction);
            return;
        }
        
        // This part of the code was removed as per the edit hint.
        // if (customId.startsWith('remove_all_roles_')) {
        //     await handleRemoveAllRoles(interaction);
        //     return;
        // }

        console.log(`[ButtonHandler] Unknown button interaction: ${customId}`);
    } catch (error) {
        console.error('[ButtonHandler] Error handling button interaction:', error);
        try {
            await interaction.reply({
                content: '❌ An error occurred while processing your request.',
                ephemeral: true
            });
        } catch (replyError) {
            console.error('[ButtonHandler] Error sending error reply:', replyError);
        }
    }
} 