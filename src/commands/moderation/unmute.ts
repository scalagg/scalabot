import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { moderationService } from '../../services/ModerationService';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove muted role from a user')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to unmute')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the unmute')
            .setRequired(true)
            .setMaxLength(1000)
    )
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

    // Check if user has permission to unmute (requires staff role)
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. This action requires staff privileges.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason', true);

    if (!targetUser) {
        await interaction.reply({
            content: '❌ Please provide a valid user.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the bot itself
    if (targetUser.id === interaction.client.user.id) {
        await interaction.reply({
            content: '❌ I cannot unmute myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot unmute yourself.',
            ephemeral: true
        });
        return;
    }

    try {
        await interaction.deferReply();

        // Get target member
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        
        if (!targetMember) {
            await interaction.editReply({
                content: '❌ User is not a member of this server.'
            });
            return;
        }

        // Check for muted role
        const mutedRole = interaction.guild.roles.cache.find(role => 
            role.name.toLowerCase() === 'muted'
        );

        if (!mutedRole) {
            await interaction.editReply({
                content: '❌ No muted role found in this server.'
            });
            return;
        }

        if (!targetMember.roles.cache.has(mutedRole.id)) {
            await interaction.editReply({
                content: '❌ This user does not have the muted role.'
            });
            return;
        }

        // Get active mutes from database
        const activeMutes = await moderationService.getActiveMutes(targetUser.id, interaction.guildId!);

        if (activeMutes.length === 0) {
            await interaction.editReply({
                content: '❌ No active mute found for this user in the database. Removing role anyway...'
            });
        }

        // Remove muted role
        await targetMember.roles.remove(mutedRole, `${reason} | Moderator: ${interaction.user.tag}`);

        // Deactivate all active mutes
        for (const mute of activeMutes) {
            await moderationService.deactivateAction(mute.punishmentId, interaction.user.id, reason);
        }

        // Send log to moderation channel
        await moderationService.sendModerationLog(
            {
                punishmentId: 'MANUAL',
                guildId: interaction.guildId!,
                userId: targetUser.id,
                moderatorId: interaction.user.id,
                action: 'unmute',
                reason,
                active: false,
                createdAt: new Date(),
                updatedAt: new Date(),
                appealable: false
            },
            targetUser,
            interaction.member as GuildMember
        );

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🔊 User Unmuted')
            .setDescription(`**${targetUser.tag}** has been unmuted.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (activeMutes.length > 0) {
            const deactivatedMutes = activeMutes.map(mute => mute.punishmentId).join(', ');
            embed.addFields({ 
                name: '🆔 Deactivated Mutes', 
                value: deactivatedMutes, 
                inline: false 
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Unmute] Error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while unmuting the user. Please try again.'
        });
    }
} 