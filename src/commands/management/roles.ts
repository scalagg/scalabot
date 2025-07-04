import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('roles')
    .setDescription('View a user\'s roles')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to check roles for')
            .setRequired(false)
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

    // Check if user has staff permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Staff role required.',
            ephemeral: true
        });
        return;
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply({ ephemeral: true });

        // Get target member
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        
        if (!targetMember) {
            await interaction.editReply({
                content: '❌ User is not a member of this server.'
            });
            return;
        }

        // Get staff roles
        const staffRoles = serverUtils.getRoles().staff;
        const adminRoles = serverUtils.getRoles().admin;
        const managerRoles = serverUtils.getRoles().manager;

        // Separate roles into categories
        const userRoles = targetMember.roles.cache
            .filter(role => role.name !== '@everyone')
            .sort((a, b) => b.position - a.position);

        const staffUserRoles = userRoles.filter(role => staffRoles.includes(role.name));
        const regularUserRoles = userRoles.filter(role => !staffRoles.includes(role.name));

        // Get highest role
        const highestRole = serverUtils.getHighestRole(targetMember);
        const roleLevel = highestRole ? serverUtils.getRoleLevel(highestRole) : 0;

        // Create embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('🎭 User Roles')
            .setDescription(`**${targetUser.tag}**'s roles in ${interaction.guild.name}`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🆔 User ID', value: targetUser.id, inline: true },
                { name: '📅 Joined', value: `<t:${Math.floor(targetMember.joinedTimestamp! / 1000)}:R>`, inline: true }
            )
            .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Add highest role information
        if (highestRole) {
            let roleType = 'Regular Member';
            if (managerRoles.includes(highestRole)) {
                roleType = 'Manager';
            } else if (adminRoles.includes(highestRole)) {
                roleType = 'Admin';
            } else if (staffRoles.includes(highestRole)) {
                roleType = 'Staff';
            }

            embed.addFields(
                { name: '🏆 Highest Role', value: highestRole, inline: true },
                { name: '📊 Role Type', value: roleType, inline: true },
                { name: '📈 Role Level', value: roleLevel.toString(), inline: true }
            );
        } else {
            embed.addFields(
                { name: '🏆 Highest Role', value: 'No staff roles', inline: true },
                { name: '📊 Role Type', value: 'Regular Member', inline: true },
                { name: '📈 Role Level', value: '0', inline: true }
            );
        }

        // Add staff roles if any
        if (staffUserRoles.size > 0) {
            const staffRolesList = staffUserRoles.map(role => {
                let prefix = '👤';
                if (managerRoles.includes(role.name)) {
                    prefix = '👑';
                } else if (adminRoles.includes(role.name)) {
                    prefix = '🛡️';
                } else if (staffRoles.includes(role.name)) {
                    prefix = '🔧';
                }
                return `${prefix} **${role.name}** (Level ${serverUtils.getRoleLevel(role.name)})`;
            }).join('\n');

            embed.addFields({ 
                name: `🛡️ Staff Roles (${staffUserRoles.size})`, 
                value: staffRolesList, 
                inline: false 
            });
        }

        // Add regular roles if any
        if (regularUserRoles.size > 0) {
            const regularRolesList = regularUserRoles.map(role => {
                return `🎭 **${role.name}**`;
            }).join('\n');

            // Truncate if too long
            const maxLength = 1024;
            const truncatedRoles = regularRolesList.length > maxLength 
                ? regularRolesList.substring(0, maxLength - 3) + '...'
                : regularRolesList;

            embed.addFields({ 
                name: `🎭 Regular Roles (${regularUserRoles.size})`, 
                value: truncatedRoles, 
                inline: false 
            });
        }

        // Add role hierarchy information
        const hierarchy = serverUtils.getRoleHierarchy();
        const userHierarchyPosition = highestRole ? hierarchy.indexOf(highestRole) : -1;
        
        if (userHierarchyPosition !== -1) {
            const hierarchyInfo = `**${highestRole}** is rank #${userHierarchyPosition + 1} of ${hierarchy.length} staff roles`;
            embed.addFields({ name: '📊 Hierarchy Position', value: hierarchyInfo, inline: false });
        }

        // Add total role count
        embed.addFields({ 
            name: '📈 Total Roles', 
            value: `${userRoles.size} roles (${staffUserRoles.size} staff, ${regularUserRoles.size} regular)`, 
            inline: false 
        });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Roles] Error viewing roles:', error);
        await interaction.editReply({
            content: '❌ An error occurred while viewing the user\'s roles. Please try again.'
        });
    }
} 