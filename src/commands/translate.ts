import { 
    ContextMenuCommandBuilder, 
    MessageContextMenuCommandInteraction,
    ApplicationCommandType
} from 'discord.js';
import { translationService } from '../services/TranslationService';

export const data = new ContextMenuCommandBuilder()
    .setName('Translate Message')
    .setType(ApplicationCommandType.Message);

export async function execute(interaction: MessageContextMenuCommandInteraction) {
    await translationService.translateMessage(interaction);
} 