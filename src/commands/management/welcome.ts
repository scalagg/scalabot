import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits,
    AttachmentBuilder
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { welcomeService } from '../../services/WelcomeService';
import { config } from '../../config/config';
import fetch from 'node-fetch';

export const data = new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Test the welcome system (sent after verification)')
    .addSubcommand(subcommand =>
        subcommand
            .setName('test')
            .setDescription('Generate a test welcome image')
            .addStringOption(option =>
                option
                    .setName('mcuser')
                    .setDescription('Minecraft username to generate welcome image for')
                    .setRequired(true)
            )
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('Discord user to use for the image (optional)')
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Check welcome system status')
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

        if (subcommand === 'test') {
            await testWelcome(interaction);
        } else if (subcommand === 'status') {
            await showStatus(interaction);
        }

    } catch (error) {
        console.error('[Welcome] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function testWelcome(interaction: ChatInputCommandInteraction) {
    const mcUsername = interaction.options.getString('mcuser', true);
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild!.members.fetch(targetUser.id);

    // Use PlayerDB to resolve username to UUID
    let uuid: string | undefined = undefined;
    let profile: any = undefined;
    try {
        const playerDbRes = await fetch(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(mcUsername)}`);
        const playerDbData: any = await playerDbRes.json();
        console.log('[WelcomeCommand][DEBUG] PlayerDB response:', playerDbData);
        if (playerDbData.code === 'player.found') {
            uuid = playerDbData.data.player.id;
        }
        if (!uuid) {
            await interaction.editReply({ content: `❌ Could not find Minecraft user "${mcUsername}" (PlayerDB lookup failed).` });
            return;
        }
        // Fetch Scala network profile
        const mcProfileRes = await fetch(`${config.apiBaseUrl}/profile/${uuid}`, {
            headers: { Authorization: config.apiKey }
        });
        if (mcProfileRes.ok) {
            profile = await mcProfileRes.json();
        }
        console.log('[WelcomeCommand][DEBUG] Scala profile response:', profile);
        if (!profile) {
            await interaction.editReply({ content: `❌ Could not fetch Scala profile for UUID "${uuid}".` });
            return;
        }
        // Fetch grants and debug rank selection
        const grantsRes = await fetch(`${config.apiBaseUrl}/grant/profile/${uuid}`, {
            headers: { Authorization: config.apiKey }
        });
        const grants: any[] = grantsRes.ok ? (await grantsRes.json() as any[]) : [];
        console.log('[WelcomeCommand][DEBUG] Grants:', grants);
        const activeGrants = grants.filter((g: any) => g.removedAt === -1);
        console.log('[WelcomeCommand][DEBUG] Active Grants:', activeGrants);
        let highestWeight = -Infinity;
        let selectedGrant = undefined;
        let selectedRankDetails = undefined;
        // Only consider visible ranks
        for (const grant of activeGrants) {
            const thisRankId = grant.rankId;
            if (!thisRankId) continue;
            const rankEndpoint = `${config.apiBaseUrl}/rank/${thisRankId}`;
            console.log('[WelcomeCommand][DEBUG] Fetching rank details from:', rankEndpoint);
            try {
                const rankRes = await fetch(rankEndpoint, { headers: { Authorization: config.apiKey } });
                if (rankRes.ok) {
                    const thisRankDetails: any = await rankRes.json();
                    const thisWeight = thisRankDetails.weight ?? 0;
                    const isVisible = thisRankDetails.visible !== false;
                    console.log(`[WelcomeCommand][DEBUG] Grant ${grant.uuid} rankId ${thisRankId} weight:`, thisWeight, 'visible:', isVisible, 'details:', thisRankDetails);
                    if (!isVisible) continue;
                    if (thisWeight > highestWeight) {
                        highestWeight = thisWeight;
                        selectedGrant = grant;
                        selectedRankDetails = thisRankDetails;
                    }
                } else {
                    console.log('[WelcomeCommand][DEBUG] Failed to fetch rank details, status:', rankRes.status);
                }
            } catch (err) {
                console.log('[WelcomeCommand][DEBUG] Error fetching rank details:', err);
            }
        }
        let rank = 'Default';
        let rankColor = '#AAAAAA';
        if (selectedGrant && selectedRankDetails) {
            let prefix = selectedRankDetails.prefix || '';
            let rankName = selectedRankDetails.name || 'Rank';
            rank = prefix ? stripMinecraftCodes(prefix) : rankName;
            // Extract color from prefix (prefer color before rank name)
            rankColor = extractRankColorFromPrefix(prefix, rankName)
                || (selectedRankDetails.color && /§[0-9a-f]/i.test(selectedRankDetails.color) ? mcColorToHex(selectedRankDetails.color.replace('§', '')) : selectedRankDetails.color)
                || '#AAAAAA';
            console.log('[WelcomeCommand][DEBUG] Selected Grant:', selectedGrant, 'with prefix:', prefix, 'name:', rankName, 'color:', rankColor);
        } else if (activeGrants.length > 0) {
            const grant = activeGrants[0];
            rank = grant.addedReason || 'Rank';
            console.log('[WelcomeCommand][DEBUG] No visible rank found, using grant addedReason:', grant.addedReason);
        } else {
            console.log('[WelcomeCommand][DEBUG] No active grants found, using Default rank.');
        }
        // Use the public WelcomeService method for MC data
        const imageBuffer = await welcomeService.generateTestImage(member, {
            username: profile.name,
            uuid: profile.uniqueId,
            rank: rank,
            rankColor: rankColor,
            level: undefined,
            guild: undefined,
            guildTag: undefined,
            firstJoin: profile.metadata && profile.metadata['first-connection'] ? new Date(Number(profile.metadata['first-connection'].value)) : undefined
        });

        const attachment = new AttachmentBuilder(imageBuffer, { name: 'welcome-test.png' });

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('success'))
            .setTitle('🎉 Welcome System Test')
            .setDescription(`Generated welcome image for MC user "${mcUsername}" and Discord user ${targetUser.tag}`)
            .setImage('attachment://welcome-test.png')
            .addFields(
                { name: '👤 Discord User', value: targetUser.tag, inline: true },
                { name: '🎮 Minecraft Username', value: profile.name, inline: true },
                { name: '🆔 UUID', value: profile.uniqueId, inline: true },
                { name: '👥 Member Count', value: interaction.guild!.memberCount.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({
            embeds: [embed],
            files: [attachment]
        });

    } catch (error) {
        console.error('[Welcome] Error generating test image:', error);
        await interaction.editReply({
            content: '❌ Failed to generate test welcome image. Check console for details.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🎉 Welcome System Status')
        .addFields(
            { 
                name: '🟢 Status', 
                value: 'Active', 
                inline: true 
            },
            { 
                name: '📝 Welcome Channel', 
                value: `<#${config.welcomeChannelId}>`, 
                inline: true 
            },
            { 
                name: '🎨 Server Theme', 
                value: serverUtils.getServerTypeFromGuildId(interaction.guildId!).toString(), 
                inline: true 
            },
            { 
                name: '📊 Member Count', 
                value: interaction.guild!.memberCount.toString(), 
                inline: true 
            },
            { 
                name: '⏰ Trigger', 
                value: 'After successful verification', 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });
}

// Helper: Minecraft color code to hex map
const mcColorMap: Record<string, string> = {
    '0': '#000000',
    '1': '#0000AA',
    '2': '#00AA00',
    '3': '#00AAAA',
    '4': '#AA0000',
    '5': '#AA00AA',
    '6': '#FFAA00',
    '7': '#AAAAAA',
    '8': '#555555',
    '9': '#5555FF',
    'a': '#55FF55',
    'b': '#55FFFF',
    'c': '#FF5555',
    'd': '#FF55FF',
    'e': '#FFFF55',
    'f': '#FFFFFF'
};
function mcColorToHex(code: string): string {
    return mcColorMap[code.toLowerCase()] || '#AAAAAA';
}

// Helper: Extract the color code that applies to the rank name in the prefix
function extractRankColorFromPrefix(prefix: string, rankName: string): string | undefined {
    // Try to find the last color code before the rank name
    const regex = new RegExp(`§([0-9a-f])(?=[^§]*${rankName})`, 'i');
    const match = prefix.match(regex);
    if (match) {
        return mcColorToHex(match[1]);
    }
    // Fallback: use the first color code in the prefix
    const first = prefix.match(/§([0-9a-f])/i);
    if (first) {
        return mcColorToHex(first[1]);
    }
    return undefined;
}

// Helper: Strip Minecraft color codes
function stripMinecraftCodes(str: string): string {
    return str.replace(/§[0-9a-fklmnor]/gi, '');
} 