import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('hierarchy')
    .setDescription('View the staff role hierarchy')
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

    // Check if user has staff permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasStaffRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Staff role required.',
            ephemeral: true
        });
        return;
    }

    try {
        // Defer reply to prevent timeout
        await interaction.deferReply({ ephemeral: true });

        // Get role hierarchy
        const hierarchy = serverUtils.getRoleHierarchy();
        const staffRoles = serverUtils.getRoles().staff;
        const adminRoles = serverUtils.getRoles().admin;
        const managerRoles = serverUtils.getRoles().manager;

        // Create hierarchy display
        const hierarchyList = hierarchy.map((role, index) => {
            let prefix = '🔧';
            let level = hierarchy.length - index; // Higher roles have higher levels
            
            if (managerRoles.includes(role)) {
                prefix = '👑';
            } else if (adminRoles.includes(role)) {
                prefix = '🛡️';
            } else if (staffRoles.includes(role)) {
                prefix = '🔧';
            }

            // Check if role exists in guild
            const guildRole = interaction.guild.roles.cache.find(r => r.name === role);
            const status = guildRole ? '✅' : '❌';
            
            return `${status} ${prefix} **${role}** (Level ${level})`;
        }).join('\n');

        // Get server info
        const serverInfo = serverUtils.getInfo();

        // Create embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('📊 Staff Role Hierarchy')
            .setDescription(`Role hierarchy for **${serverInfo.name}**`)
            .addFields(
                { name: '🏆 Hierarchy (Highest to Lowest)', value: hierarchyList, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        // Add role statistics
        const totalRoles = hierarchy.length;
        const existingRoles = hierarchy.filter(role => 
            interaction.guild.roles.cache.find(r => r.name === role)
        ).length;
        const missingRoles = totalRoles - existingRoles;

        embed.addFields(
            { name: '📈 Statistics', value: `Total Roles: ${totalRoles}\nExisting: ${existingRoles}\nMissing: ${missingRoles}`, inline: true }
        );

        // Add role categories
        const managerCount = managerRoles.length;
        const adminCount = adminRoles.length;
        const staffCount = staffRoles.length;

        embed.addFields(
            { name: '👑 Managers', value: managerCount.toString(), inline: true },
            { name: '🛡️ Admins', value: adminCount.toString(), inline: true },
            { name: '🔧 Staff', value: staffCount.toString(), inline: true }
        );

        // Add missing roles warning if any
        if (missingRoles > 0) {
            const missingRolesList = hierarchy
                .filter(role => !interaction.guild.roles.cache.find(r => r.name === role))
                .join(', ');
            
            embed.addFields({
                name: '⚠️ Missing Roles',
                value: `The following roles need to be created: ${missingRolesList}`,
                inline: false
            });
        }

        // Add current user's position
        const userHighestRole = serverUtils.getHighestRole(interaction.member);
        if (userHighestRole) {
            const userLevel = serverUtils.getRoleLevel(userHighestRole);
            const userPosition = hierarchy.indexOf(userHighestRole) + 1;
            
            embed.addFields({
                name: '👤 Your Position',
                value: `**${userHighestRole}** - Level ${userLevel} (Rank #${userPosition} of ${totalRoles})`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Hierarchy] Error viewing hierarchy:', error);
        await interaction.editReply({
            content: '❌ An error occurred while viewing the hierarchy. Please try again.'
        });
    }
} 