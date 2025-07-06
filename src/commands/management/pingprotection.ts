import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { pingProtectionService } from '../../services/PingProtectionService';

export const data = new SlashCommandBuilder()
    .setName('pingprotection')
    .setDescription('Manage the ping protection system')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Show ping protection status')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('enable')
            .setDescription('Enable ping protection')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('disable')
            .setDescription('Disable ping protection')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('test')
            .setDescription('Test ping protection with a user')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('User to test ping protection with')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('whitelist-channel')
            .setDescription('Add current channel to whitelist')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('unwhitelist-channel')
            .setDescription('Remove current channel from whitelist')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('whitelist-user')
            .setDescription('Add a user to whitelist')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('User to whitelist')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('unwhitelist-user')
            .setDescription('Remove a user from whitelist')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('User to remove from whitelist')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('set-message')
            .setDescription('Set custom warning message')
            .addStringOption(option =>
                option
                    .setName('message')
                    .setDescription('Custom warning message')
                    .setRequired(true)
                    .setMaxLength(2000)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('toggle-delete')
            .setDescription('Toggle whether to delete ping messages')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

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

    const subcommand = interaction.options.getSubcommand();

    try {
        await interaction.deferReply({ ephemeral: true });

        if (subcommand === 'status') {
            await showStatus(interaction);
        } else if (subcommand === 'enable') {
            await enableProtection(interaction);
        } else if (subcommand === 'disable') {
            await disableProtection(interaction);
        } else if (subcommand === 'test') {
            await testProtection(interaction);
        } else if (subcommand === 'whitelist-channel') {
            await whitelistChannel(interaction);
        } else if (subcommand === 'unwhitelist-channel') {
            await unwhitelistChannel(interaction);
        } else if (subcommand === 'whitelist-user') {
            await whitelistUser(interaction);
        } else if (subcommand === 'unwhitelist-user') {
            await unwhitelistUser(interaction);
        } else if (subcommand === 'set-message') {
            await setMessage(interaction);
        } else if (subcommand === 'toggle-delete') {
            await toggleDelete(interaction);
        }

    } catch (error) {
        console.error('[PingProtection] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    const config = pingProtectionService.getConfig();
    const adminRoles = serverUtils.getRoles().admin;
    const managerRoles = serverUtils.getRoles().manager;
    const whitelistedChannels = pingProtectionService.getWhitelistedChannels();
    const whitelistedUsers = pingProtectionService.getWhitelistedUsers();

    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🛡️ Ping Protection Status')
        .addFields(
            { 
                name: '🟢 Status', 
                value: config.enabled ? 'Enabled' : 'Disabled', 
                inline: true 
            },
            { 
                name: '🗑️ Delete Messages', 
                value: config.deleteMessages ? 'Yes' : 'No', 
                inline: true 
            },
            { 
                name: '📝 Log Violations', 
                value: config.logViolations ? 'Yes' : 'No', 
                inline: true 
            },
            { 
                name: '👑 Protected Admin Roles', 
                value: adminRoles.join(', ') || 'None', 
                inline: false 
            },
            { 
                name: '🎭 Protected Manager Roles', 
                value: managerRoles.join(', ') || 'None', 
                inline: false 
            },
            { 
                name: '📝 Whitelisted Channels', 
                value: whitelistedChannels.length > 0 
                    ? whitelistedChannels.map(id => `<#${id}>`).join(', ')
                    : 'None', 
                inline: false 
            },
            { 
                name: '👥 Whitelisted Users', 
                value: whitelistedUsers.length > 0 
                    ? whitelistedUsers.map(id => `<@${id}>`).join(', ')
                    : 'None', 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    // Add warning message preview
    const warningMessage = config.warningMessage;
    if (warningMessage.length > 1024) {
        embed.addFields({
            name: '⚠️ Warning Message',
            value: warningMessage.substring(0, 1021) + '...',
            inline: false
        });
    } else {
        embed.addFields({
            name: '⚠️ Warning Message',
            value: warningMessage,
            inline: false
        });
    }

    await interaction.editReply({ embeds: [embed] });
}

async function enableProtection(interaction: ChatInputCommandInteraction) {
    pingProtectionService.setEnabled(true);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Ping Protection Enabled')
        .setDescription('Ping protection is now active and will prevent users from pinging admin and manager roles.')
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function disableProtection(interaction: ChatInputCommandInteraction) {
    pingProtectionService.setEnabled(false);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('warning'))
        .setTitle('⚠️ Ping Protection Disabled')
        .setDescription('Ping protection is now inactive.')
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function testProtection(interaction: ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user', true);
    
    // Check if the target user has protected roles
    const member = await interaction.guild!.members.fetch(targetUser.id);
    const adminRoles = serverUtils.getRoles().admin;
    const managerRoles = serverUtils.getRoles().manager;
    const protectedRoles = [...adminRoles, ...managerRoles];
    
    const userRoles = member.roles.cache.map(role => role.name);
    const hasProtectedRole = userRoles.some(role => protectedRoles.includes(role));
    const protectedRole = userRoles.find(role => protectedRoles.includes(role));

    const embed = new EmbedBuilder()
        .setColor(hasProtectedRole ? serverUtils.getColor('warning') : serverUtils.getColor('success'))
        .setTitle('🧪 Ping Protection Test')
        .addFields(
            { 
                name: '👤 Test User', 
                value: `${targetUser.tag} (<@${targetUser.id}>)`, 
                inline: true 
            },
            { 
                name: '🛡️ Protected', 
                value: hasProtectedRole ? 'Yes' : 'No', 
                inline: true 
            },
            { 
                name: '🎭 Highest Role', 
                value: protectedRole || 'None', 
                inline: true 
            },
            { 
                name: '📝 All Roles', 
                value: userRoles.join(', ') || 'None', 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    if (hasProtectedRole) {
        embed.setDescription(`⚠️ **${targetUser.tag} has protected roles and would trigger ping protection.**`);
    } else {
        embed.setDescription(`✅ **${targetUser.tag} does not have protected roles and would not trigger ping protection.**`);
    }

    await interaction.editReply({ embeds: [embed] });
}

async function whitelistChannel(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel) {
        await interaction.editReply({
            content: '❌ This command can only be used in a text channel.'
        });
        return;
    }

    pingProtectionService.addWhitelistedChannel(interaction.channel.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Channel Whitelisted')
        .setDescription(`<#${interaction.channel.id}> is now whitelisted from ping protection.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function unwhitelistChannel(interaction: ChatInputCommandInteraction) {
    if (!interaction.channel) {
        await interaction.editReply({
            content: '❌ This command can only be used in a text channel.'
        });
        return;
    }

    pingProtectionService.removeWhitelistedChannel(interaction.channel.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Channel Unwhitelisted')
        .setDescription(`<#${interaction.channel.id}> is no longer whitelisted from ping protection.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function whitelistUser(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    
    pingProtectionService.addWhitelistedUser(user.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ User Whitelisted')
        .setDescription(`${user.tag} is now whitelisted from ping protection.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function unwhitelistUser(interaction: ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    
    pingProtectionService.removeWhitelistedUser(user.id);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ User Unwhitelisted')
        .setDescription(`${user.tag} is no longer whitelisted from ping protection.`)
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function setMessage(interaction: ChatInputCommandInteraction) {
    const message = interaction.options.getString('message', true);
    
    pingProtectionService.setWarningMessage(message);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Warning Message Updated')
        .setDescription('The ping protection warning message has been updated.')
        .addFields({
            name: '📝 New Message',
            value: message.length > 1024 ? message.substring(0, 1021) + '...' : message,
            inline: false
        })
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function toggleDelete(interaction: ChatInputCommandInteraction) {
    const currentSetting = pingProtectionService.getDeleteMessages();
    const newSetting = !currentSetting;
    
    pingProtectionService.setDeleteMessages(newSetting);
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('success'))
        .setTitle('✅ Delete Messages Toggled')
        .setDescription(`Ping messages will ${newSetting ? 'now be deleted' : 'no longer be deleted'}.`)
        .addFields({
            name: '🗑️ Current Setting',
            value: newSetting ? 'Delete messages' : 'Keep messages',
            inline: true
        })
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
} 