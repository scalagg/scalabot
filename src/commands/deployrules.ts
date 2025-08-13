import { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ChatInputCommandInteraction,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('deployrules')
    .setDescription('Deploy the server rules embeds')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        // Set server type
        const serverType = serverUtils.getServerTypeFromGuildId(interaction.guild!.id);
        serverUtils.setServerType(serverType);

        // Defer reply since this might take a while
        await interaction.deferReply({ ephemeral: true });

        const embeds = buildRulesEmbeds();
        
        // Send all embeds
        for (const embed of embeds) {
            await (interaction.channel as any).send({ embeds: [embed] });
        }

        await interaction.editReply({
            content: `✅ Successfully deployed ${embeds.length} rules embeds!`
        });

    } catch (error) {
        console.error('[DeployRules] Error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while deploying the rules embeds.'
        });
    }
}

function buildRulesEmbeds(): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];

    // Overview
    embeds.push(new EmbedBuilder()
        .setTitle('Server Rules & Punishments')
        .setColor(serverUtils.getColor('primary'))
        .setTimestamp()
        .setDescription([
            '- **Privacy Notice**: By joining the Discord and using the rules acceptance command, you allow the network to withhold some information such as extensive punishment history. This is normal and not a concern.',
            '- **Punishment Escalation**: Severity I–III offenses increase by 4 hours each time (e.g., Severity I = 4h, Severity II = 8h, etc.)'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Severity 1
    embeds.push(new EmbedBuilder()
        .setTitle('Severity 1 Offenses — 4-Hour Mute (Prior Warning)')
        .setColor(serverUtils.getColor('success'))
        .setTimestamp()
        .setDescription([
            '- **Spamming Chat**: General spamming, character spamming, excessive caps, bot command spam, ASCII art, spam tagging users/staff.',
            '- **Rudeness/Trolling**: Including excessive arguing.',
            '- **Inappropriate Behavior**: No NSFW or any behavior that makes others uncomfortable.',
            '- **Light Advertisement**: Mentioning other servers/discords, social media links.',
            '- **Tagging Admins/Developers**: Don\'t ping Admin or above. Use Admin Support Waiting Room or create a ticket.',
            '- **Mini-Modding**: Telling others to follow the rules/stop breaking rules.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Severity 2
    embeds.push(new EmbedBuilder()
        .setTitle('Severity 2 Offenses — Instant 24-Hour Mute or *Ban (Depends on Rule Broken)')
        .setColor(serverUtils.getColor('warning'))
        .setTimestamp()
        .setDescription([
            '- **Abusive Behavior**: Being very verbally abusive with intent to upset; may include filter bypass while being rude.',
            '- **Bypassing Vulgarity Filter**: Any attempt to bypass the filter will be punished.',
            '- **Inappropriate Discord Username/Profile Picture/Status**: You have 5 minutes to change it or a ban may be issued.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Severity 3
    embeds.push(new EmbedBuilder()
        .setTitle('Severity 3 Offenses — Instant 1-Week Mute or *Ban (Depends on Rule Broken)')
        .setColor(serverUtils.getColor('warning'))
        .setTimestamp()
        .setDescription([
            '- **Impersonation**: Do not impersonate users or staff, even as a joke.',
            '- **Bigotry/Racism/Discrimination**: Strictly forbidden. If you disagree, disengage.',
            '- **Harassment**: Do not harass others. If asked to stop, you must stop.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Severity 4
    embeds.push(new EmbedBuilder()
        .setTitle('Severity 4 Offenses — Instant Permanent Ban')
        .setColor(serverUtils.getColor('error'))
        .setTimestamp()
        .setDescription([
            '- **Posting Scam/Malicious/Inappropriate/Unapproved Links**: Do not post screamers or malicious/unapproved links.',
            '- **Unapproved Transactions**: Anything not of the HolyPvP variety (e.g., Optifine capes, Steam gift cards).',
            '- **Unapproved Attachments**: Any type except image/video.',
            '- **Malicious Threats**: Threats to harm/kill, hack, or DDoS (including jokes).',
            '- **Revealing Personal Information**: No doxxing, even if \'public information\' (including jokes).',
            '- **Punishment Evasion**: Evading punishments may result in an instant Discord ban.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Voice 1
    embeds.push(new EmbedBuilder()
        .setTitle('Voice Chat Severity 1 — 4-Hour VC Ban or Verbal Warning')
        .setColor(serverUtils.getColor('success'))
        .setTimestamp()
        .setDescription([
            '- **Excessive Background Noise**: You may be muted from VCs until resolved; request unmute after fix.',
            '- **Inappropriate Behavior**: No NSFW or behavior that makes others uncomfortable.',
            '- **Mic Spam/Soundboards/Voice Changers/Music Without Approval**: Everyone in the VC must agree.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Voice 2
    embeds.push(new EmbedBuilder()
        .setTitle('Voice Chat Severity 2 — Instant 24-Hour VC Ban')
        .setColor(serverUtils.getColor('warning'))
        .setTimestamp()
        .setDescription([
            '- **Trolling**: Don\'t be a troll in VC.',
            '- **Impersonation of Staff**: Use your staff account when in VC or risk a ban for impersonation.',
            '- **Abusive Behavior**: Verbally abusive behavior with intent to upset; may include filter bypass while rude.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Voice 3
    embeds.push(new EmbedBuilder()
        .setTitle('Voice Chat Severity 3 — Instant 1-Week VC Ban')
        .setColor(serverUtils.getColor('warning'))
        .setTimestamp()
        .setDescription([
            '- **Screaming/Blasting Microphone**: Deliberately making loud sounds into the mic.',
            '- **Bigotry/Racism/Discrimination**: Strictly forbidden. If you disagree, disengage.',
            '- **Harassment**: Do not harass others. If asked to stop, you must stop.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    // Voice 4
    embeds.push(new EmbedBuilder()
        .setTitle('Voice Chat Severity 4 — Instant Permanent VC Ban')
        .setColor(serverUtils.getColor('error'))
        .setTimestamp()
        .setDescription([
            '- **Advertising**: Do not advertise servers in VC to disrupt the traffic of our server.'
        ].join('\n'))
        .setFooter(serverUtils.getFooter())
    );

    return embeds;
} 