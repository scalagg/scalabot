import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a user to the previous role in the hierarchy')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to demote')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the demotion')
            .setRequired(true)
            .setMaxLength(1000)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

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

    // Check if user has admin permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Admin role required.',
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
            content: '❌ I cannot demote myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot demote yourself.',
            ephemeral: true
        });
        return;
    }

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply();

        // Get target member
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        
        if (!targetMember) {
            await interaction.editReply({
                content: '❌ User is not a member of this server.'
            });
            return;
        }

        // Get current highest role
        const currentHighestRole = serverUtils.getHighestRole(targetMember);
        
        if (!currentHighestRole) {
            await interaction.editReply({
                content: '❌ This user does not have any staff roles to demote from.'
            });
            return;
        }

        // Get role hierarchy
        const hierarchy = serverUtils.getRoleHierarchy();
        const currentRoleIndex = hierarchy.indexOf(currentHighestRole);
        
        if (currentRoleIndex === -1) {
            await interaction.editReply({
                content: '❌ Could not determine the user\'s current role position in the hierarchy.'
            });
            return;
        }

        // Check if user is already at the bottom
        if (currentRoleIndex === hierarchy.length - 1) {
            await interaction.editReply({
                content: '❌ This user is already at the lowest role level and cannot be demoted further.'
            });
            return;
        }

        // Get the previous role in hierarchy
        const previousRoleName = hierarchy[currentRoleIndex + 1]; // +1 because lower roles are at higher indices
        const previousRole = interaction.guild.roles.cache.find(r => r.name === previousRoleName);
        
        if (!previousRole) {
            await interaction.editReply({
                content: `❌ The previous role "${previousRoleName}" does not exist in this server.`
            });
            return;
        }

        // Check if moderator can demote to this level
        const moderatorHighestRole = serverUtils.getHighestRole(interaction.member);
        if (moderatorHighestRole) {
            const moderatorLevel = serverUtils.getRoleLevel(moderatorHighestRole);
            const previousRoleLevel = serverUtils.getRoleLevel(previousRoleName);
            
            if (previousRoleLevel >= moderatorLevel) {
                await interaction.editReply({
                    content: '❌ You cannot demote someone to a role that is higher than or equal to your highest role.'
                });
                return;
            }
        }

        // Check if target has higher role than moderator
        const targetLevel = serverUtils.getRoleLevel(currentHighestRole);
        if (moderatorHighestRole) {
            const moderatorLevel = serverUtils.getRoleLevel(moderatorHighestRole);
            
            if (targetLevel >= moderatorLevel) {
                await interaction.editReply({
                    content: '❌ You cannot demote someone with a higher or equal role to yours.'
                });
                return;
            }
        }

        // Remove current role and add previous role
        const currentRole = interaction.guild.roles.cache.find(r => r.name === currentHighestRole);
        if (currentRole) {
            await targetMember.roles.remove(currentRole, `Demoted to ${previousRoleName} | Reason: ${reason} | By: ${interaction.user.tag}`);
        }
        
        await targetMember.roles.add(previousRole, `Demoted from ${currentHighestRole} | Reason: ${reason} | By: ${interaction.user.tag}`);

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('warning'))
            .setTitle('⬇️ User Demoted Successfully')
            .setDescription(`**${targetUser.tag}** has been demoted.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Admin', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📉 Demotion', value: `${currentHighestRole} → ${previousRoleName}`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Demote] Error demoting user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while demoting the user. Please try again.'
        });
    }
} 