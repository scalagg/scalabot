import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { sentryService } from '../../services/SentryService';

export const data = new SlashCommandBuilder()
    .setName('threadunblacklist')
    .setDescription('Remove a user from the thread creation blacklist')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to remove from the thread blacklist')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for removing the user from the thread blacklist')
            .setRequired(true))
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason', true);
        const blacklistRoleId = '1405387259967967242';

        if (!targetUser) {
            await interaction.reply({
                content: '❌ Invalid user specified.',
                ephemeral: true
            });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                ephemeral: true
            });
            return;
        }

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            await interaction.reply({
                content: '❌ User is not a member of this server.',
                ephemeral: true
            });
            return;
        }

        // Check if user is actually blacklisted
        if (!targetMember.roles.cache.has(blacklistRoleId)) {
            await interaction.reply({
                content: '❌ This user is not currently blacklisted from creating threads.',
                ephemeral: true
            });
            return;
        }

        // Remove the blacklist role
        await targetMember.roles.remove(blacklistRoleId, `Thread unblacklist by ${interaction.user.tag}: ${reason}`);

        // Create embed for the unblacklist notification
        const unblacklistEmbed = new EmbedBuilder()
            .setColor('#43B581')
            .setTitle('✅ Thread Creation Unblacklisted')
            .setDescription(`You have been removed from the thread creation blacklist in **${guild.name}**.`)
            .addFields(
                { name: 'Reason', value: reason, inline: false },
                { name: 'Unblacklisted by', value: `${interaction.user.tag}`, inline: true },
                { name: 'Date', value: new Date().toLocaleDateString(), inline: true }
            )
            .setFooter({ text: 'You can now create threads in forums again.' })
            .setTimestamp();

        // Send DM to the unblacklisted user
        try {
            await targetUser.send({ embeds: [unblacklistEmbed] });
        } catch (dmError) {
            console.warn(`[ThreadUnblacklist] Could not send DM to ${targetUser.tag}:`, dmError);
        }

        // Create embed for the staff response
        const responseEmbed = new EmbedBuilder()
            .setColor('#43B581')
            .setTitle('✅ User Thread Unblacklisted')
            .setDescription(`Successfully removed **${targetUser.tag}** from the thread creation blacklist.`)
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Unblacklisted by', value: `${interaction.user.tag}`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [responseEmbed] });

    } catch (error) {
        console.error('[ThreadUnblacklist] Error unblacklisting user:', error);
        sentryService.captureException(error as Error, {
            context: 'thread_unblacklist',
            user_id: interaction.user.id,
            guild_id: interaction.guildId,
            target_user_id: interaction.options.getUser('user')?.id
        });

        await interaction.reply({
            content: '❌ An error occurred while unblacklisting the user. Please try again.',
            ephemeral: true
        });
    }
}
