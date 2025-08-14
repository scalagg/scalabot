import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { sentryService } from '../../services/SentryService';

export const data = new SlashCommandBuilder()
    .setName('threadblacklist')
    .setDescription('Blacklist a user from creating threads in forums')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to blacklist from creating threads')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for blacklisting the user from threads')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

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

        // Check if user is already blacklisted
        if (targetMember.roles.cache.has(blacklistRoleId)) {
            await interaction.reply({
                content: '❌ This user is already blacklisted from creating threads.',
                ephemeral: true
            });
            return;
        }

        // Add the blacklist role
        await targetMember.roles.add(blacklistRoleId, `Thread blacklist by ${interaction.user.tag}: ${reason}`);

        // Create embed for the blacklist notification
        const blacklistEmbed = new EmbedBuilder()
            .setColor('#FF4444')
            .setTitle('🚫 Thread Creation Blacklisted')
            .setDescription(`You have been blacklisted from creating threads in **${guild.name}**.`)
            .addFields(
                { name: 'Reason', value: reason, inline: false },
                { name: 'Blacklisted by', value: `${interaction.user.tag}`, inline: true },
                { name: 'Date', value: new Date().toLocaleDateString(), inline: true }
            )
            .setFooter({ text: 'If you believe this was a mistake, please contact a staff member.' })
            .setTimestamp();

        // Send DM to the blacklisted user
        try {
            await targetUser.send({ embeds: [blacklistEmbed] });
        } catch (dmError) {
            console.warn(`[ThreadBlacklist] Could not send DM to ${targetUser.tag}:`, dmError);
        }

        // Create embed for the staff response
        const responseEmbed = new EmbedBuilder()
            .setColor('#FF4444')
            .setTitle('🚫 User Thread Blacklisted')
            .setDescription(`Successfully blacklisted **${targetUser.tag}** from creating threads.`)
            .addFields(
                { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Blacklisted by', value: `${interaction.user.tag}`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [responseEmbed] });

    } catch (error) {
        console.error('[ThreadBlacklist] Error blacklisting user:', error);
        sentryService.captureException(error as Error, {
            context: 'thread_blacklist',
            user_id: interaction.user.id,
            guild_id: interaction.guildId,
            target_user_id: interaction.options.getUser('user')?.id
        });

        await interaction.reply({
            content: '❌ An error occurred while blacklisting the user. Please try again.',
            ephemeral: true
        });
    }
}
