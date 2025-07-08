import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { antiNukeService } from '../../services/AntiNukeService';
import { config } from '../../config/config';

export const data = new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Manage anti-nuke protection system')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Check anti-nuke system status')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('config')
            .setDescription('View current anti-nuke configuration')
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
        } else if (subcommand === 'config') {
            await showConfig(interaction);
        }

    } catch (error) {
        console.error('[AntiNuke] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    const status = antiNukeService.getStatus(interaction.guildId!);
    const antiNukeConfig = config.antiNukeConfig;
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🛡️ Anti-Nuke System Status')
        .addFields(
            { 
                name: '🟢 System Status', 
                value: antiNukeConfig.enabled ? 'Enabled' : 'Disabled', 
                inline: true 
            },
            { 
                name: '📊 Recent Bans', 
                value: `${status.recentBans} in last 10s`, 
                inline: true 
            },
            { 
                name: '👢 Recent Kicks', 
                value: `${status.recentKicks} in last 10s`, 
                inline: true 
            },
            { 
                name: '📁 Recent Channel Deletions', 
                value: `${status.recentChannelDeletions} in last 10s`, 
                inline: true 
            },
            { 
                name: '🎭 Recent Role Deletions', 
                value: `${status.recentRoleDeletions} in last 10s`, 
                inline: true 
            },
            { 
                name: '📁 Recent Channel Creations', 
                value: `${status.recentChannelCreations} in last 10s`, 
                inline: true 
            },
            { 
                name: '🎭 Recent Role Creations', 
                value: `${status.recentRoleCreations} in last 10s`, 
                inline: true 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

async function showConfig(interaction: ChatInputCommandInteraction) {
    const antiNukeConfig = config.antiNukeConfig;
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('⚙️ Anti-Nuke Configuration')
        .addFields(
            { 
                name: '🟢 Enabled', 
                value: antiNukeConfig.enabled ? 'Yes' : 'No', 
                inline: true 
            },
            { 
                name: '⏰ Time Window', 
                value: `${antiNukeConfig.timeWindow / 1000} seconds`, 
                inline: true 
            },
            { 
                name: '🚫 Mass Ban Threshold', 
                value: antiNukeConfig.massBanThreshold.toString(), 
                inline: true 
            },
            { 
                name: '👢 Mass Kick Threshold', 
                value: antiNukeConfig.massKickThreshold.toString(), 
                inline: true 
            },
            { 
                name: '📁 Mass Channel Delete Threshold', 
                value: antiNukeConfig.massChannelDeleteThreshold.toString(), 
                inline: true 
            },
            { 
                name: '🎭 Mass Role Delete Threshold', 
                value: antiNukeConfig.massRoleDeleteThreshold.toString(), 
                inline: true 
            },
            { 
                name: '📁 Mass Channel Create Threshold', 
                value: antiNukeConfig.massChannelCreateThreshold.toString(), 
                inline: true 
            },
            { 
                name: '🎭 Mass Role Create Threshold', 
                value: antiNukeConfig.massRoleCreateThreshold.toString(), 
                inline: true 
            },
            { 
                name: '🔐 Permission Escalation Roles', 
                value: antiNukeConfig.permissionEscalationRoles.join(', '), 
                inline: false 
            },
            { 
                name: '📝 Configuration Note', 
                value: 'To modify these settings, update the `antiNuke` section in your `config.toml` file and restart the bot.', 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
} 