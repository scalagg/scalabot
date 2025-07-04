import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a user to the next role in the hierarchy')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to promote')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for the promotion')
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
            content: '❌ I cannot promote myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot promote yourself.',
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
                content: '❌ This user does not have any staff roles to promote from.'
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

        // Check if user is already at the top
        if (currentRoleIndex === 0) {
            await interaction.editReply({
                content: '❌ This user is already at the highest role level and cannot be promoted further.'
            });
            return;
        }

        // Get the next role in hierarchy
        const nextRoleName = hierarchy[currentRoleIndex - 1]; // -1 because higher roles are at lower indices
        const nextRole = interaction.guild.roles.cache.find(r => r.name === nextRoleName);
        
        if (!nextRole) {
            await interaction.editReply({
                content: `❌ The next role "${nextRoleName}" does not exist in this server.`
            });
            return;
        }

        // Check if moderator can promote to this level
        const moderatorHighestRole = serverUtils.getHighestRole(interaction.member);
        if (moderatorHighestRole) {
            const moderatorLevel = serverUtils.getRoleLevel(moderatorHighestRole);
            const nextRoleLevel = serverUtils.getRoleLevel(nextRoleName);
            
            if (nextRoleLevel >= moderatorLevel) {
                await interaction.editReply({
                    content: '❌ You cannot promote someone to a role that is higher than or equal to your highest role.'
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
                    content: '❌ You cannot promote someone with a higher or equal role to yours.'
                });
                return;
            }
        }

        // Remove current role and add next role
        const currentRole = interaction.guild.roles.cache.find(r => r.name === currentHighestRole);
        if (currentRole) {
            await targetMember.roles.remove(currentRole, `Promoted to ${nextRoleName} | Reason: ${reason} | By: ${interaction.user.tag}`);
        }
        
        await targetMember.roles.add(nextRole, `Promoted from ${currentHighestRole} | Reason: ${reason} | By: ${interaction.user.tag}`);

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('⬆️ User Promoted Successfully')
            .setDescription(`**${targetUser.tag}** has been promoted!`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Admin', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '📈 Promotion', value: `${currentHighestRole} → ${nextRoleName}`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Promote] Error promoting user:', error);
        await interaction.editReply({
            content: '❌ An error occurred while promoting the user. Please try again.'
        });
    }
} 