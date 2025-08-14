import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction } from 'discord.js';
import { sentryService } from '../services/SentryService';
import { syncService } from '../services/SyncService';

export const data = new SlashCommandBuilder()
    .setName('deploysync')
    .setDescription('Deploy the sync embed in the sync channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                ephemeral: true
            });
            return;
        }

        // Find or create sync channel
        let syncChannel = guild.channels.cache.find(channel => 
            channel.name === '💻sync' && channel.type === 0
        ) as any;

        if (!syncChannel) {
            syncChannel = await guild.channels.create({
                name: '💻sync',
                type: 0, // Text channel
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: ['SendMessages'],
                        allow: ['ViewChannel', 'ReadMessageHistory']
                    }
                ]
            });
        }

        // Clear existing messages in the channel
        const messages = await syncChannel.messages.fetch();
        if (messages.size > 0) {
            await syncChannel.bulkDelete(messages);
        }

        // Send the sync embed
        const syncEmbed = syncService.createSyncEmbed();
        await syncChannel.send({ embeds: [syncEmbed] });

        await interaction.reply({
            content: `✅ Sync embed has been deployed in ${syncChannel}!`,
            ephemeral: true
        });

    } catch (error) {
        console.error('[DeploySync] Error deploying sync embed:', error);
        sentryService.captureException(error as Error, {
            context: 'deploy_sync',
            user_id: interaction.user.id,
            guild_id: interaction.guildId
        });

        await interaction.reply({
            content: '❌ An error occurred while deploying the sync embed. Please try again.',
            ephemeral: true
        });
    }
}
