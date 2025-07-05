import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    EmbedBuilder
} from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';
import { giveawayService } from '../services/GiveawayService';

export const data = new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join a giveaway')
    .addStringOption(option =>
        option
            .setName('message_id')
            .setDescription('The message ID of the giveaway to join')
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({
            content: '❌ This command can only be used in a server.',
            ephemeral: true
        });
        return;
    }

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

    const messageId = interaction.options.getString('message_id', true);
    const userId = interaction.user.id;

    try {
        await interaction.deferReply({ ephemeral: true });

        // Check if giveaway exists and is active
        const giveaway = await giveawayService.getGiveawayById(messageId);
        if (!giveaway) {
            await interaction.editReply({
                content: '❌ Giveaway not found.'
            });
            return;
        }

        if (giveaway.ended) {
            await interaction.editReply({
                content: '❌ This giveaway has already ended.'
            });
            return;
        }

        // Check if user is already participating
        const isParticipating = await giveawayService.isParticipating(messageId, userId);
        if (isParticipating) {
            await interaction.editReply({
                content: '❌ You are already participating in this giveaway!'
            });
            return;
        }

        // Add participant
        const success = await giveawayService.addParticipant(messageId, userId);
        if (!success) {
            await interaction.editReply({
                content: '❌ Failed to join the giveaway. Please try again.'
            });
            return;
        }

        // Update the giveaway message
        const updatedGiveaway = await giveawayService.getGiveawayById(messageId);
        if (updatedGiveaway) {
            const embed = giveawayService.createGiveawayEmbed(updatedGiveaway);
            const buttons = giveawayService.createGiveawayButtons(updatedGiveaway);
            
            try {
                const channel = await interaction.guild!.channels.fetch(giveaway.channelId);
                if (channel && channel.isTextBased()) {
                    const message = await channel.messages.fetch(messageId).catch(() => null);
                    if (message) {
                        await message.edit({
                            embeds: [embed],
                            components: [buttons]
                        });
                    }
                }
            } catch (error) {
                console.warn('[Join] Could not update giveaway message:', error);
            }
        }

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🎉 Joined Giveaway!')
            .setDescription(`You have successfully joined the giveaway for: **${giveaway.prize}**`)
            .addFields(
                { name: '👥 Participants', value: (updatedGiveaway?.participants.length || giveaway.participants.length).toString(), inline: true },
                { name: '🏆 Winners', value: giveaway.winners.toString(), inline: true },
                { name: '⏰ Ends', value: `<t:${Math.floor(giveaway.endsAt / 1000)}:R>`, inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Join] Error joining giveaway:', error);
        await interaction.editReply({
            content: '❌ An error occurred while joining the giveaway. Please try again.'
        });
    }
} 