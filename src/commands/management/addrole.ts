import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    ActionRowBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('addrole')
    .setDescription('Add a role to a user')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to add the role to')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('role')
            .setDescription('The role to add')
            .setRequired(true)
            .setAutocomplete(true)
    )
    .addStringOption(option =>
        option
            .setName('reason')
            .setDescription('Reason for adding the role')
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
    const roleName = interaction.options.getString('role', true);
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
            content: '❌ I cannot add roles to myself.',
            ephemeral: true
        });
        return;
    }

    // Check if target is the command user
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({
            content: '❌ You cannot add roles to yourself.',
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

        // Get all roles in the guild (excluding @everyone)
        const guildRoles = interaction.guild.roles.cache
            .filter(role => role.name !== '@everyone')
            .sort((a, b) => b.position - a.position);
        
        // Check if the requested role exists in the guild
        const role = guildRoles.find(r => r.name === roleName);
        
        if (!role) {
            await interaction.editReply({
                content: `❌ The role "${roleName}" does not exist in this server.`
            });
            return;
        }



        // Check if user already has the role
        if (targetMember.roles.cache.has(role.id)) {
            await interaction.editReply({
                content: `❌ **${targetUser.tag}** already has the **${roleName}** role.`
            });
            return;
        }

        // Check if target has higher role than moderator
        const targetHighestRole = serverUtils.getHighestRole(targetMember);
        const moderatorHighestRole = serverUtils.getHighestRole(interaction.member);
        
        if (targetHighestRole && moderatorHighestRole) {
            const targetLevel = serverUtils.getRoleLevel(targetHighestRole);
            const moderatorLevel = serverUtils.getRoleLevel(moderatorHighestRole);
            
            if (targetLevel >= moderatorLevel) {
                await interaction.editReply({
                    content: '❌ You cannot add roles to someone with a higher or equal role to yours.'
                });
                return;
            }
        }

        // Check if the role being added is higher than the moderator's highest role
        if (moderatorHighestRole) {
            // Skip position check if user has ADMINISTRATOR permission
            if (!interaction.member.permissions.has('Administrator')) {
                // For non-staff roles, check if the role position is higher than moderator's role
                if (role.position >= interaction.member.roles.highest.position) {
                    await interaction.editReply({
                        content: '❌ You cannot add a role that is higher than or equal to your highest role.'
                    });
                    return;
                }
            }
        }

        // Add the role
        await targetMember.roles.add(role, `${reason} | Added by: ${interaction.user.tag}`);

        // Create success embed
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('✅ Role Added Successfully')
            .setDescription(`**${roleName}** role has been added to **${targetUser.tag}**.`)
            .addFields(
                { name: '👤 User', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
                { name: '🛡️ Admin', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
                { name: '🎭 Role', value: roleName, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[AddRole] Error adding role:', error);
        await interaction.editReply({
            content: '❌ An error occurred while adding the role. Please try again.'
        });
    }
}

// Autocomplete function for role selection
export async function autocomplete(interaction: any) {
    const focusedValue = interaction.options.getFocused();
    
    // Get all roles in the guild (excluding @everyone)
    const guildRoles = Array.from(interaction.guild.roles.cache.values())
        .filter((role: any) => role.name !== '@everyone')
        .sort((a: any, b: any) => b.position - a.position);
    
    // Filter roles based on input
    const filteredRoles = guildRoles.filter((role: any) => 
        role.name.toLowerCase().includes(focusedValue.toLowerCase())
    );
    
    // Return up to 25 options
    const choices = filteredRoles.slice(0, 25).map((role: any) => ({
        name: role.name,
        value: role.name
    }));
    
    await interaction.respond(choices);
} 