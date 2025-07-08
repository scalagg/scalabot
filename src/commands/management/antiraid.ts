import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { antiRaidService } from '../../services/AntiRaidService';
import { config } from '../../config/config';

export const data = new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('Manage anti-raid protection system')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Check anti-raid system status')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('enable-heightened')
            .setDescription('Manually enable heightened verification mode')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('disable-heightened')
            .setDescription('Manually disable heightened verification mode')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('config')
            .setDescription('View current anti-raid configuration')
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
        } else if (subcommand === 'enable-heightened') {
            await enableHeightenedVerification(interaction);
        } else if (subcommand === 'disable-heightened') {
            await disableHeightenedVerification(interaction);
        } else if (subcommand === 'config') {
            await showConfig(interaction);
        }

    } catch (error) {
        console.error('[AntiRaid] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    const status = antiRaidService.getStatus(interaction.guildId!);
    const antiRaidConfig = config.antiRaidConfig;
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🛡️ Anti-Raid System Status')
        .addFields(
            { 
                name: '🟢 System Status', 
                value: antiRaidConfig.enabled ? 'Enabled' : 'Disabled', 
                inline: true 
            },
            { 
                name: '🔒 Heightened Verification', 
                value: status.isHeightenedVerification ? 'Active' : 'Inactive', 
                inline: true 
            },
            { 
                name: '📊 Recent Joins', 
                value: `${status.recentJoins} in last 30s`, 
                inline: true 
            },
            { 
                name: '⚠️ Suspicious Accounts', 
                value: status.suspiciousAccounts.toString(), 
                inline: true 
            },
            { 
                name: '🎯 Join Threshold', 
                value: `${antiRaidConfig.joinThreshold} joins in ${antiRaidConfig.timeWindow / 1000}s`, 
                inline: true 
            },
            { 
                name: '⏰ Account Age Threshold', 
                value: `${Math.floor(antiRaidConfig.newAccountThreshold / (1000 * 60 * 60))} hours`, 
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function enableHeightenedVerification(interaction: ChatInputCommandInteraction) {
    // This would require modifying the AntiRaidService to expose this method
    // For now, we'll show a message about manual activation
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('warning'))
        .setTitle('🔒 Heightened Verification')
        .setDescription('Heightened verification mode is automatically enabled when a raid is detected.')
        .addFields(
            { 
                name: '📝 Manual Activation', 
                value: 'To manually enable heightened verification, you can simulate a raid by having multiple accounts join quickly, or modify the configuration to lower the threshold temporarily.', 
                inline: false 
            },
            { 
                name: '⏰ Auto-Disable', 
                value: 'Heightened verification automatically disables after 10 minutes of no suspicious activity.', 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function disableHeightenedVerification(interaction: ChatInputCommandInteraction) {
    // This would require modifying the AntiRaidService to expose this method
    // For now, we'll show a message about automatic disabling
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🔓 Heightened Verification')
        .setDescription('Heightened verification mode automatically disables after 10 minutes of no suspicious activity.')
        .addFields(
            { 
                name: '⏰ Current Status', 
                value: 'The system will automatically return to normal verification mode when the threat has passed.', 
                inline: false 
            },
            { 
                name: '🛡️ Protection', 
                value: 'This automatic system ensures your server remains protected while minimizing disruption to legitimate users.', 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function showConfig(interaction: ChatInputCommandInteraction) {
    const antiRaidConfig = config.antiRaidConfig;
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('⚙️ Anti-Raid Configuration')
        .addFields(
            { 
                name: '🟢 Enabled', 
                value: antiRaidConfig.enabled ? 'Yes' : 'No', 
                inline: true 
            },
            { 
                name: '📊 Join Threshold', 
                value: antiRaidConfig.joinThreshold.toString(), 
                inline: true 
            },
            { 
                name: '⏰ Time Window', 
                value: `${antiRaidConfig.timeWindow / 1000} seconds`, 
                inline: true 
            },
            { 
                name: '📅 Account Age Threshold', 
                value: `${Math.floor(antiRaidConfig.newAccountThreshold / (1000 * 60 * 60))} hours`, 
                inline: true 
            },
            { 
                name: '🔍 Suspicious Patterns', 
                value: `${antiRaidConfig.suspiciousUsernamePatterns.length} patterns configured`, 
                inline: true 
            },
            { 
                name: '📝 Configuration Note', 
                value: 'To modify these settings, update the `antiRaid` section in your `config.toml` file and restart the bot.', 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
} 