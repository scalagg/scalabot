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
    .setName('untimeout')
    .setDescription('Remove timeout or muted role from a user')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to untimeout')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the untimeout')
            .setRequired(true)
            .setMaxLength(1000)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

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

    // Check if user has permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command.',
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
            content: '❌ I cannot untimeout myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot untimeout yourself.',
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

        let actionTaken = false;
        let actionType = '';

        // Check for Discord timeout first
        if (targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil.getTime() > Date.now()) {
            await targetMember.timeout(null, `${reason} | Moderator: ${interaction.user.tag}`);
            actionTaken = true;
            actionType = 'Discord timeout';
        }

        // Check for muted role
        const mutedRole = interaction.guild.roles.cache.find(role => 
            role.name.toLowerCase() === 'muted' || 
            role.name.toLowerCase() === 'mute' ||
            role.name.toLowerCase() === 'silenced' ||
            role.name.toLowerCase() === 'silence' ||
            role.name.toLowerCase() === 'quiet' ||
            role.name.toLowerCase() === 'no-talk' ||
            role.name.toLowerCase() === 'notalk'
        );

        if (mutedRole && targetMember.roles.cache.has(mutedRole.id)) {
            await targetMember.roles.remove(mutedRole, `${reason} | Moderator: ${interaction.user.tag}`);
            actionTaken = true;
            actionType = actionType ? `${actionType} and muted role` : 'muted role';
        }

        // Get active actions from database
        const activeActions = await moderationService.getActiveActions(targetUser.id, interaction.guildId!);
        const timeoutActions = activeActions.filter(action => action.action === 'timeout');
        const muteActions = activeActions.filter(action => action.action === 'mute');

        // Deactivate all active timeout and mute actions
        for (const action of [...timeoutActions, ...muteActions]) {
            await moderationService.deactivateAction(action.punishmentId, interaction.user.id, reason);
        }

        if (!actionTaken && timeoutActions.length === 0 && muteActions.length === 0) {
            await interaction.editReply({
                content: '❌ This user is not currently timed out or muted.'
            });
            return;
        }

        // Send log to moderation channel
        const logEmbed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🔊 User Untimeout/Unmute')
            .setDescription(`**${targetUser.tag}** has been ${actionType ? actionType.replace(' and ', ' and ').toLowerCase() : 'untimeout/unmuted'}.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

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
            .setTitle('🔊 User Untimeout/Unmute')
            .setDescription(`**${targetUser.tag}** has been ${actionType ? actionType.replace(' and ', ' and ').toLowerCase() : 'untimeout/unmuted'}.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (timeoutActions.length > 0 || muteActions.length > 0) {
            const deactivatedActions = [...timeoutActions, ...muteActions].map(action => action.punishmentId).join(', ');
            embed.addFields({ 
                name: '🆔 Deactivated Actions', 
                value: deactivatedActions, 
                inline: false 
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Untimeout] Error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while untimeouting the user. Please try again.'
        });
    }
} 